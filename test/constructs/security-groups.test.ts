/**
 * Unit tests for SecurityGroupsConstruct
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { SecurityGroupsConstruct } from '../../lib/constructs/security-groups';

describe('SecurityGroupsConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack');
    vpc = new ec2.Vpc(stack, 'TestVPC');
  });

  test('creates three security groups', () => {
    new SecurityGroupsConstruct(stack, 'TestSecurityGroups', { vpc });
    
    const template = Template.fromStack(stack);
    
    // Should have 3 security groups (ALB, Lambda, InfluxDB)
    // Note: VPC may create a default SG but we're counting our 3
    const securityGroups = template.findResources('AWS::EC2::SecurityGroup');
    const ourSecurityGroups = Object.values(securityGroups).filter(sg => 
      (sg.Properties?.GroupDescription as string)?.includes('Application Load Balancer') ||
      (sg.Properties?.GroupDescription as string)?.includes('Lambda CRUD service') ||
      (sg.Properties?.GroupDescription as string)?.includes('InfluxDB EC2 instance')
    );
    expect(ourSecurityGroups.length).toBe(3);
  });

  test('ALB security group allows HTTP from anywhere', () => {
    new SecurityGroupsConstruct(stack, 'TestSecurityGroups', { vpc });
    
    const template = Template.fromStack(stack);
    
    // Verify ALB security group allows port 80 from 0.0.0.0/0
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Security group for Application Load Balancer',
      SecurityGroupIngress: [
        {
          CidrIp: '0.0.0.0/0',
          Description: 'Allow HTTP traffic from anywhere',
          FromPort: 80,
          IpProtocol: 'tcp',
          ToPort: 80,
        },
      ],
    });
  });

  test('Lambda security group allows all outbound', () => {
    new SecurityGroupsConstruct(stack, 'TestSecurityGroups', { vpc });
    
    const template = Template.fromStack(stack);
    
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Security group for Lambda CRUD service',
      SecurityGroupEgress: [
        {
          CidrIp: '0.0.0.0/0',
          Description: 'Allow all outbound traffic by default',
          IpProtocol: '-1',
        },
      ],
    });
  });

  test('InfluxDB security group allows port 8086 from Lambda', () => {
    new SecurityGroupsConstruct(stack, 'TestSecurityGroups', { vpc });
    
    const template = Template.fromStack(stack);
    
    // InfluxDB SG ingress rule is created as separate SecurityGroupIngress resource
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      Description: 'Allow InfluxDB access from Lambda CRUD service',
      FromPort: 8086,
      IpProtocol: 'tcp',
      ToPort: 8086,
    });
  });

  test('exports all three security groups', () => {
    const securityGroups = new SecurityGroupsConstruct(stack, 'TestSecurityGroups', { vpc });
    
    expect(securityGroups.albSecurityGroup).toBeDefined();
    expect(securityGroups.lambdaSecurityGroup).toBeDefined();
    expect(securityGroups.influxDbSecurityGroup).toBeDefined();
  });

  test('security groups are in correct VPC', () => {
    const securityGroups = new SecurityGroupsConstruct(stack, 'TestSecurityGroups', { vpc });
    
    const template = Template.fromStack(stack);
    
    // All security groups should reference the VPC
    const securityGroupResources = template.findResources('AWS::EC2::SecurityGroup');
    const securityGroupsWithVpc = Object.values(securityGroupResources).filter(sg => {
      return sg.Properties?.VpcId !== undefined;
    });
    
    expect(securityGroupsWithVpc.length).toBeGreaterThanOrEqual(3);
  });

  test('ALB security group has correct egress rules', () => {
    new SecurityGroupsConstruct(stack, 'TestSecurityGroups', { vpc });
    
    const template = Template.fromStack(stack);
    
    // ALB should allow all outbound
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Security group for Application Load Balancer',
      SecurityGroupEgress: [
        {
          CidrIp: '0.0.0.0/0',
          Description: 'Allow all outbound traffic by default',
          IpProtocol: '-1',
        },
      ],
    });
  });

  test('InfluxDB security group has correct egress rules', () => {
    new SecurityGroupsConstruct(stack, 'TestSecurityGroups', { vpc });
    
    const template = Template.fromStack(stack);
    
    // InfluxDB should allow all outbound
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Security group for InfluxDB EC2 instance',
      SecurityGroupEgress: [
        {
          CidrIp: '0.0.0.0/0',
          Description: 'Allow all outbound traffic by default',
          IpProtocol: '-1',
        },
      ],
    });
  });

  test('security group descriptions are correct', () => {
    new SecurityGroupsConstruct(stack, 'TestSecurityGroups', { vpc });
    
    const template = Template.fromStack(stack);
    const securityGroups = template.findResources('AWS::EC2::SecurityGroup');
    
    const descriptions = Object.values(securityGroups)
      .map(sg => sg.Properties?.GroupDescription as string)
      .filter(desc => desc !== undefined);
    
    expect(descriptions).toContain('Security group for Application Load Balancer');
    expect(descriptions).toContain('Security group for Lambda CRUD service');
    expect(descriptions).toContain('Security group for InfluxDB EC2 instance');
  });

  test('construct is under 150 lines of code', () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../../lib/constructs/security-groups.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').length;
    
    expect(lines).toBeLessThanOrEqual(150);
  });
});
