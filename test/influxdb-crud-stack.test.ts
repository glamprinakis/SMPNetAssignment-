import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { InfluxDbCrudStack } from '../lib/influxdb-crud-stack';

describe('InfluxDbCrudStack', () => {
  test('Stack creates VPC with correct configuration', () => {
    const app = new cdk.App();
    const stack = new InfluxDbCrudStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Verify VPC exists
    template.resourceCountIs('AWS::EC2::VPC', 1);
    
    // Verify subnets exist (2 public + 2 private)
    template.resourceCountIs('AWS::EC2::Subnet', 4);
    
    // Verify NAT Gateway
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
    
    // Verify Internet Gateway
    template.resourceCountIs('AWS::EC2::InternetGateway', 1);
  });

  test('Stack creates required security groups', () => {
    const app = new cdk.App();
    const stack = new InfluxDbCrudStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Should have 3 security groups (ALB, Lambda, InfluxDB)
    template.resourceCountIs('AWS::EC2::SecurityGroup', 3);
  });

  test('Stack creates Lambda function', () => {
    const app = new cdk.App();
    const stack = new InfluxDbCrudStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'python3.11',
      Timeout: 30
    });
  });

  test('Stack creates Application Load Balancer', () => {
    const app = new cdk.App();
    const stack = new InfluxDbCrudStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Type: 'application'
    });
  });

  test('Stack creates EC2 instance for InfluxDB', () => {
    const app = new cdk.App();
    const stack = new InfluxDbCrudStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't2.micro'
    });
  });

  test('Stack creates CloudWatch alarms', () => {
    const app = new cdk.App();
    const stack = new InfluxDbCrudStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Should have 3 alarms (CPU, Response Time, Lambda Errors)
    template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
  });

  test('Stack creates required outputs', () => {
    const app = new cdk.App();
    const stack = new InfluxDbCrudStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Verify outputs exist
    const outputs = template.toJSON().Outputs;
    expect(outputs).toHaveProperty('ALBDnsName');
    expect(outputs).toHaveProperty('InfluxDbPrivateIp');
    expect(outputs).toHaveProperty('VpcId');
    expect(outputs).toHaveProperty('ApiEndpoint');
  });
});
