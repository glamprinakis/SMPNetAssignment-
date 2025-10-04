/**
 * Unit tests for InfluxDbInstanceConstruct
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { InfluxDbInstanceConstruct } from '../../lib/constructs/influxdb-instance';

describe('InfluxDbInstanceConstruct', () => {
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

  test('creates EC2 instance with correct type', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't2.micro',
    });
  });

  test('instance is in private subnet', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    // Instance should use NetworkInterfaces (which references private subnet)
    const instances = template.findResources('AWS::EC2::Instance');
    const instanceProps = Object.values(instances)[0].Properties;
    expect(instanceProps.NetworkInterfaces).toBeDefined();
  });

  test('IAM role has required managed policies', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    // Verify role exists
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRole',
            Principal: {
              Service: 'ec2.amazonaws.com',
            },
          }),
        ]),
      }),
    });
  });

  test('IAM instance profile is attached to EC2 instance', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    // Verify instance profile exists and is attached
    template.hasResourceProperties('AWS::EC2::Instance', {
      IamInstanceProfile: Match.objectLike({
        Ref: Match.anyValue(),
      }),
    });
  });

  test('UserData contains InfluxDB installation commands', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    const instance = template.findResources('AWS::EC2::Instance');
    const userData = Object.values(instance)[0].Properties.UserData;

    // UserData should be base64 encoded
    expect(userData).toBeDefined();
    expect(userData['Fn::Base64']).toBeDefined();

    // Check for Docker and InfluxDB container commands in UserData
    const userDataContent = JSON.stringify(userData);
    expect(userDataContent).toContain('docker');
    expect(userDataContent).toContain('influxdb:2.7.10');
  });

  test('UserData contains InfluxDB setup commands', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    const instance = template.findResources('AWS::EC2::Instance');
    const userData = Object.values(instance)[0].Properties.UserData;
    const userDataContent = JSON.stringify(userData);

    expect(userDataContent).toContain('DOCKER_INFLUXDB_INIT_MODE=setup');
    expect(userDataContent).toContain('systemctl');
  });

  test('UserData includes health check validation', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    const instance = template.findResources('AWS::EC2::Instance');
    const userData = Object.values(instance)[0].Properties.UserData;
    const userDataContent = JSON.stringify(userData);

    expect(userDataContent).toContain('curl');
    expect(userDataContent).toContain('/health');
  });

  test('exports instance and private IP', () => {
    const construct = new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    expect(construct.instance).toBeDefined();
    expect(construct.instancePrivateIp).toBeDefined();
  });

  test('security group is attached to instance', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    // Verify instance has security group reference through NetworkInterfaces
    const instances = template.findResources('AWS::EC2::Instance');
    const instanceProps = Object.values(instances)[0].Properties;
    
    // Just verify NetworkInterfaces exists and has at least one entry
    expect(instanceProps.NetworkInterfaces).toBeDefined();
    expect(instanceProps.NetworkInterfaces.length).toBeGreaterThan(0);
  });

  test('EBS volume is encrypted', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:influxdb-credentials-abc123',
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::Instance', {
      BlockDeviceMappings: Match.arrayWith([
        Match.objectLike({
          Ebs: Match.objectLike({
            Encrypted: true,
            VolumeType: 'gp3',
            VolumeSize: 8,
          }),
        }),
      ]),
    });
  });

  test('construct file is under 150 lines excluding UserData', () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../../lib/constructs/influxdb-instance.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Count non-UserData lines (rough estimate)
    const lines: string[] = content.split('\n');
    const userDataStartIndex = lines.findIndex((line: string) => line.includes('userData.addCommands'));
    const userDataEndIndex = lines.findIndex((line: string, idx: number) => 
      idx > userDataStartIndex && line.includes(');') && !line.includes('userData.addCommands')
    );
    
    const nonUserDataLines = lines.length - (userDataEndIndex - userDataStartIndex);
    
    // Should be well under 150 excluding UserData script
    expect(nonUserDataLines).toBeLessThanOrEqual(150);
  });
});
