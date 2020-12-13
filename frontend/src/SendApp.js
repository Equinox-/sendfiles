import React, { useState } from "react";
import config from "./Config";
import {
  NEW_ANSWER,
  NEW_OFFER,
  NEW_RECIPIENT,
  NEW_ICE_CANDIDATE,
} from "./Constants";
import { genKey, encryptMessage, exportKeyAsBase64 } from "./Crypto";
import { readFile } from "./File";
import { Sender } from "./FileTransfer";
import ClipboardButton from "./ClipboardButton";
import "./SendApp.css";

function getReceiverLink(id) {
  const currentURL = new URL(window.location.href);
  return `${currentURL.origin}/receive/${id}`;
}

function SendApp() {
  const [fileDetails, setFileDetails] = useState();
  const [password, setPassword] = useState("");
  const [receiveLink, setReceiveLink] = useState();
  const [passwordPlaceholder] = useState(
    Math.random() < 0.5 ? "hunter2" : "correct-horse-battery-staple"
  );

  const onFileSelected = (e) => {
    const file = e.target.files[0];
    if (!file) {
      console.log("No file chosen");
      return;
    }

    setFileDetails(file);
  };

  const sender = async (e) => {
    e.preventDefault();

    const key = await genKey();
    const contents = await readFile(fileDetails);
    const encrypted = await encryptMessage(contents, key, password);

    // first, post metadata
    const validUntil = new Date(
      Date.now() + config.FILE_VALID_HOURS * 60 * 60 * 1000
    );
    const encodedKey = await exportKeyAsBase64(key);
    const metadata = {
      fileName: fileDetails.name,
      contentLengthBytes: encrypted.byteLength,
      privateKey: encodedKey,
      validUntil: validUntil,
    };

    const transferDetails = await fetch(config.TRANSFER_API, {
      method: "POST",
      mode: "cors", // TODO make this not CORS if possible
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    }).then((resp) => resp.json());

    const receiverLink = getReceiverLink(transferDetails.id);
    setReceiveLink(receiverLink);

    const socketUrl = new URL(config.COORD_API);
    socketUrl.searchParams.set("role", "offerer");
    socketUrl.searchParams.set("transfer_id", transferDetails.id);
    const socket = new WebSocket(socketUrl);

    const senders = new Map();
    const senderSocketOnMessage = async (event) => {
      const { sender: senderAddress, body: rawBody } = JSON.parse(event.data);
      const body = JSON.parse(rawBody);

      switch (body.type) {
        case NEW_ANSWER: {
          const sender = senders[senderAddress];
          await sender.registerAnswer(body.answer);
          break;
        }
        case NEW_ICE_CANDIDATE: {
          const sender = senders[senderAddress];
          const candidate = new RTCIceCandidate(body.candidate);
          sender.addIceCandidate(candidate);
          break;
        }
        default:
          throw new Error(`Unsupported message type ${body.type}`);
      }
    };

    socket.onmessage = async function (event) {
      const { sender: senderAddress, body: rawBody } = JSON.parse(event.data);
      const body = JSON.parse(rawBody);

      switch (body.type) {
        case NEW_RECIPIENT: {
          const senderSocketUrl = new URL(config.COORD_API);
          senderSocketUrl.searchParams.set("role", "sender");
          senderSocketUrl.searchParams.set("transfer_id", transferDetails.id);
          const senderSocket = new WebSocket(senderSocketUrl);
          senderSocket.onmessage = senderSocketOnMessage;

          // need to wait for the socket to open
          await new Promise((resolve, reject) => {
            senderSocket.onopen = resolve;
          });

          const sender = new Sender(senderSocket, encrypted);
          sender.setRecipientAddress(senderAddress);
          senders[senderAddress] = sender;

          const offer = await sender.createOffer();
          const resp = { type: NEW_OFFER, offer };
          sender.sendMessage(resp);
          break;
        }
        default:
          throw new Error(`Unsupported message type ${body.type}`);
      }
    };
  };

  return (
    <div>
      <form>
        <div className="form-field">
          <label>How it works</label>
          <div>
            <a href="/">sendfiles.dev</a> allows you to transfer files directly
            from one browser to another without going through an intermediary
            server by utilizing{" "}
            <a
              href="https://webrtc.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              WebRTC
            </a>
            . Files are encrypted in your browser using the password you
            provide. The files are decrypted in the receiver's browser using the
            same password. Click <a href="/about">here</a> to read about the
            security properties.
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="file_input">Select a file to transfer</label>
          <div className="form-description">
            Note the file will not be uploaded to a server. When you click
            submit, a unique link will be generated allowing the receiver to
            download the file directly from your browser.
          </div>
          <input id="file_input" type="file" onChange={onFileSelected} />
        </div>
        <div className="form-field">
          <label htmlFor="password">Choose a password</label>
          <div className="form-description">
            The password will be used to encrypt your file. You will need to
            share it with the recipient.
          </div>
          <input
            id="password"
            type="password"
            placeholder={passwordPlaceholder}
            onChange={(e) => setPassword(e.target.value)}
            value={password}
          />
        </div>
        {!receiveLink ? (
          <div>
            <label htmlFor="submit">Generate link</label>
            <div className="form-description">
              Clicking <code>Generate</code> will encrypt your file in your
              browser using the provided password. It'll then generate a unique
              link that you can share for users to transfer the encrypted file
              directly from your browser.
            </div>
            <button
              id="submit"
              type="submit"
              className="filled submit-button"
              onClick={sender}
            >
              Generate
            </button>
          </div>
        ) : (
          <div>
            <label>Share</label>
            <div className="instruction-browser-open">
              You'll need to leave this window open until the file is completely
              copied to their browser.
            </div>
            <div className="form-description">
              Send the following link to the recipient, along with your
              password:
            </div>
            <div className="receive-link-container">
              <div className="receive-link">
                <a href={receiveLink} target="_blank" rel="noopener noreferrer">
                  {receiveLink}
                </a>
              </div>
              <div className="copy-button">
                <ClipboardButton content={receiveLink} />
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

export default SendApp;
