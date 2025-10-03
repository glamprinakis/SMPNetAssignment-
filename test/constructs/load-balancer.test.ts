/**
 * Unit tests for LoadBalancerConstruct
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { LoadBalancerConstruct } from '../../lib/constructs/load-balancer';

describe('LoadBalancerConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let securityGroup: ec2.SecurityGroup;
  let lambdaFunction: lambda.Function;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack');
    vpc = new ec2.Vpc(stack, 'TestVPC');
    securityGroup = new ec2.SecurityGroup(stack, 'TestSG', { vpc });
    lambdaFunction = new lambda.Function(stack, 'TestFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromInline('def handler(event, context): return {"statusCode": 200}'),
    });
  });

  test('creates Application Load Balancer', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Type: 'application',
    });
  });

  test('ALB is deployed in public subnets', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Subnets: Match.anyValue(),
    });
  });

  test('creates HTTP listener on port 80', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
    });
  });

  test('creates Lambda target group', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      TargetType: 'lambda',
    });
  });

  test('target group has health check configured', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckEnabled: true,
      HealthCheckPath: '/health',
      HealthCheckIntervalSeconds: 30,
      HealthCheckTimeoutSeconds: 10,
      HealthyThresholdCount: 2,
      UnhealthyThresholdCount: 3,
    });
  });

  test('uses custom health check path when provided', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
      healthCheckPath: '/api/health',
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/api/health',
    });
  });

  test('uses custom health check interval when provided', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
      healthCheckIntervalSeconds: 60,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckIntervalSeconds: 60,
    });
  });

  test('Lambda function has ALB invoke permission', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'elasticloadbalancing.amazonaws.com',
    });
  });

  test('listener forwards to target group', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      DefaultActions: Match.arrayWith([
        Match.objectLike({
          Type: 'forward',
        }),
      ]),
    });
  });

  test('uses provided security group', () => {
    new LoadBalancerConstruct(stack, 'TestLB', {
      vpc,
      securityGroup,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      SecurityGroups: Match.arrayWith([
        Match.objectLike({
          'Fn::GetAtt': Match.arrayWith([
            Match.stringLikeRegexp('TestSG'),
            'GroupId',
          ]),
        }),
      ]),
    });
  });
});
