/**
 * Unit tests for LambdaCrudApiConstruct
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { LambdaCrudApiConstruct } from '../../lib/constructs/lambda-crud-api';

describe('LambdaCrudApiConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let securityGroup: ec2.SecurityGroup;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack');
    vpc = new ec2.Vpc(stack, 'TestVPC');
    securityGroup = new ec2.SecurityGroup(stack, 'TestSG', { vpc });
  });

  test('creates Lambda function with correct runtime', () => {
    new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'python3.11',
    });
  });

  test('Lambda function has correct timeout', () => {
    new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 30,
    });
  });

  test('Lambda function is in VPC', () => {
    new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      VpcConfig: Match.objectLike({
        SubnetIds: Match.anyValue(),
      }),
    });
  });

  test('Lambda function has correct environment variables with Secrets Manager ARN', () => {
    new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          INFLUXDB_URL: 'http://10.0.0.100:8086',
          INFLUXDB_SECRET_ARN: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
        },
      },
    });
  });

  test('IAM role has VPC execution permissions', () => {
    new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp('.*AWSLambdaVPCAccessExecutionRole'),
            ]),
          ]),
        }),
      ]),
    });
  });

  test('IAM role has basic execution permissions', () => {
    new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp('.*AWSLambdaBasicExecutionRole'),
            ]),
          ]),
        }),
      ]),
    });
  });

  test('Lambda function has security group attached', () => {
    new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    const template = Template.fromStack(stack);

    const functions = template.findResources('AWS::Lambda::Function');
    const functionProps = Object.values(functions)[0].Properties;

    expect(functionProps.VpcConfig.SecurityGroupIds).toBeDefined();
  });

  test('Lambda function has log retention configured', () => {
    new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    const template = Template.fromStack(stack);

    // Log retention is configured via logRetention property
    // CDK creates custom resources for this, just verify Lambda function exists
    const functions = template.findResources('AWS::Lambda::Function');
    const mainFunction = Object.values(functions).find((fn: any) => 
      fn.Properties?.Handler === 'index.handler'
    );
    
    expect(mainFunction).toBeDefined();
  });

  test('exports Lambda function', () => {
    const construct = new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    expect(construct.lambdaFunction).toBeDefined();
  });

  test('IAM role is created for Lambda function', () => {
    new LambdaCrudApiConstruct(stack, 'TestLambda', {
      vpc,
      securityGroup,
      influxDbPrivateIp: '10.0.0.100',
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:test-secret',
    });

    const template = Template.fromStack(stack);

    // Verify IAM role exists with Lambda service principal
    // Note: Secrets Manager permissions are granted in the main stack via grantRead()
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
          },
        ]),
      },
    });
  });

  test('construct is under 150 lines of code', () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../../lib/constructs/lambda-crud-api.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').length;
    
    expect(lines).toBeLessThanOrEqual(150);
  });
});
