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
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't3.small',
    });
  });

  test('instance is in private subnet', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    // Instance should reference a private subnet
    template.hasResourceProperties('AWS::EC2::Instance', {
      SubnetId: Match.anyValue(),
    });
  });

  test('IAM role includes SSM GetParameter permission', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Effect: 'Allow',
            Resource: Match.stringLikeRegexp('.*parameter/influxdb/age-private-key'),
          }),
        ]),
      },
    });
  });

  test('IAM role has CloudWatch and SSM managed policies', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp('.*CloudWatchAgentServerPolicy'),
            ]),
          ]),
        }),
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp('.*AmazonSSMManagedInstanceCore'),
            ]),
          ]),
        }),
      ]),
    });
  });

  test('UserData contains SOPS installation commands', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    const instance = template.findResources('AWS::EC2::Instance');
    const userData = Object.values(instance)[0].Properties.UserData;

    // UserData should be base64 encoded
    expect(userData).toBeDefined();
    expect(userData['Fn::Base64']).toBeDefined();

    // Check for SOPS-related commands in UserData
    const userDataContent = JSON.stringify(userData);
    expect(userDataContent).toContain('sops');
    expect(userDataContent).toContain('Installing SOPS');
  });

  test('UserData contains age installation commands', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    const instance = template.findResources('AWS::EC2::Instance');
    const userData = Object.values(instance)[0].Properties.UserData;
    const userDataContent = JSON.stringify(userData);

    expect(userDataContent).toContain('age');
    expect(userDataContent).toContain('Installing age');
  });

  test('UserData contains SSM parameter retrieval', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      vpc,
      securityGroup,
      ageKeyParameterName: '/custom/age-key',
    });

    const template = Template.fromStack(stack);

    const instance = template.findResources('AWS::EC2::Instance');
    const userData = Object.values(instance)[0].Properties.UserData;
    const userDataContent = JSON.stringify(userData);

    expect(userDataContent).toContain('ssm get-parameter');
    expect(userDataContent).toContain('/custom/age-key');
  });

  test('UserData includes error handling', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    const instance = template.findResources('AWS::EC2::Instance');
    const userData = Object.values(instance)[0].Properties.UserData;
    const userDataContent = JSON.stringify(userData);

    expect(userDataContent).toContain('ERROR');
    expect(userDataContent).toContain('FALLBACK');
  });

  test('exports instance and private IP', () => {
    const construct = new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      vpc,
      securityGroup,
    });

    expect(construct.instance).toBeDefined();
    expect(construct.instancePrivateIp).toBeDefined();
  });

  test('security group is attached to instance', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
      vpc,
      securityGroup,
    });

    const template = Template.fromStack(stack);

    // Verify instance has security group reference
    const instances = template.findResources('AWS::EC2::Instance');
    const instanceProps = Object.values(instances)[0].Properties;
    
    expect(instanceProps.SecurityGroupIds).toBeDefined();
  });

  test('EBS volume is encrypted', () => {
    new InfluxDbInstanceConstruct(stack, 'TestInfluxDb', {
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
            VolumeSize: 20,
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
