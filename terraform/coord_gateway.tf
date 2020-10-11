locals {
  routes = {
    connect = {
      route_key      = "$connect"
      operation_name = "ConnectRoute"
    }
    disconnect = {
      route_key      = "$disconnect"
      operation_name = "DisconnectRoute"
    }
    sendmessage = {
      route_key      = "sendmessage"
      operation_name = "SendRoute"
    }
  }
}
resource "aws_apigatewayv2_api" "coord" {
  name                         = "coord-ws-api"
  protocol_type                = "WEBSOCKET"
  disable_execute_api_endpoint = false # TODO change this to true when fronted by domain
}

resource "aws_apigatewayv2_deployment" "deployment" {
  api_id = aws_apigatewayv2_api.coord.id

  depends_on = [aws_apigatewayv2_route.route]
}

resource "aws_apigatewayv2_stage" "Stage" {
  api_id        = aws_apigatewayv2_api.coord.id
  name          = "prod"
  description   = "Prod Stage"
  deployment_id = aws_apigatewayv2_deployment.deployment.id
}

resource "aws_apigatewayv2_integration" "integration" {
  api_id             = aws_apigatewayv2_api.coord.id
  integration_type   = "AWS_PROXY"
  description        = "integration"
  integration_uri    = aws_lambda_function.coord_api.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "route" {
  for_each       = local.routes
  api_id         = aws_apigatewayv2_api.coord.id
  route_key      = each.value.route_key
  operation_name = each.value.operation_name
  target         = "integrations/${aws_apigatewayv2_integration.integration.id}"
}