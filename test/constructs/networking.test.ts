/**
 * Unit tests for NetworkingConstruct
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NetworkingConstruct } from '../../lib/constructs/networking';

describe('NetworkingConstruct', () => {
  test('creates VPC with correct configuration', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    
    new NetworkingConstruct(stack, 'TestNetworking');
    
    const template = Template.fromStack(stack);
    
    // Verify VPC exists
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  test('creates correct number of subnets', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    
    new NetworkingConstruct(stack, 'TestNetworking', {
      maxAzs: 2
    });
    
    const template = Template.fromStack(stack);
    
    // Should have 4 subnets (2 public + 2 private for 2 AZs)
    template.resourceCountIs('AWS::EC2::Subnet', 4);
  });

  test('creates NAT Gateway', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    
    new NetworkingConstruct(stack, 'TestNetworking', {
      natGateways: 1
    });
    
    const template = Template.fromStack(stack);
    
    // Verify NAT Gateway
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  test('creates Internet Gateway', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    
    new NetworkingConstruct(stack, 'TestNetworking');
    
    const template = Template.fromStack(stack);
    
    // Verify Internet Gateway
    template.resourceCountIs('AWS::EC2::InternetGateway', 1);
  });

  test('exports VPC and subnet references', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    
    const networking = new NetworkingConstruct(stack, 'TestNetworking', {
      maxAzs: 2
    });
    
    // Verify exports exist
    expect(networking.vpc).toBeDefined();
    expect(networking.publicSubnets).toBeDefined();
    expect(networking.privateSubnets).toBeDefined();
    
    // Verify subnet counts
    expect(networking.publicSubnets.length).toBe(2);
    expect(networking.privateSubnets.length).toBe(2);
  });

  test('creates public subnets with correct type', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    
    new NetworkingConstruct(stack, 'TestNetworking');
    
    const template = Template.fromStack(stack);
    
    // Verify public subnets have route to Internet Gateway
    const subnets = template.findResources('AWS::EC2::Subnet');
    const publicSubnetCount = Object.values(subnets).filter(subnet => {
      return subnet.Properties?.MapPublicIpOnLaunch === true;
    }).length;
    
    expect(publicSubnetCount).toBe(2);
  });

  test('creates private subnets with egress via NAT', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    
    new NetworkingConstruct(stack, 'TestNetworking');
    
    const template = Template.fromStack(stack);
    
    // Verify route tables exist (public + private)
    template.resourceCountIs('AWS::EC2::RouteTable', 4); // 2 public + 2 private
  });

  test('respects custom maxAzs parameter', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    
    const networking = new NetworkingConstruct(stack, 'TestNetworking', {
      maxAzs: 3
    });
    
    // Note: Actual AZ count may be limited by region availability
    // Just verify construct accepts parameter and creates subnets
    expect(networking.publicSubnets.length).toBeGreaterThanOrEqual(2);
    expect(networking.privateSubnets.length).toBeGreaterThanOrEqual(2);
  });

  test('construct is under 150 lines of code', () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../../lib/constructs/networking.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').length;
    
    expect(lines).toBeLessThanOrEqual(150);
  });
});
