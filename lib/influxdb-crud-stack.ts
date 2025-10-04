import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NetworkingConstruct } from './constructs/networking';
import { SecurityGroupsConstruct } from './constructs/security-groups';
import { InfluxDbInstanceConstruct } from './constructs/influxdb-instance';
import { LambdaCrudApiConstruct } from './constructs/lambda-crud-api';
import { LoadBalancerConstruct } from './constructs/load-balancer';
import { MonitoringConstruct } from './constructs/monitoring';

export class InfluxDbCrudStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================
    // Networking (VPC, Subnets, NAT, IGW)
    // ============================================
    const networking = new NetworkingConstruct(this, 'InfluxDbVPC', {
      maxAzs: 2,
      natGateways: 1,
      cidrMask: 24,
    });
    
    const vpc = networking.vpc;

    // ============================================
    // Note: Using default CDK asset handling to avoid KMS permission issues
    // ============================================

    // ============================================
    // SSM Parameter for Age Private Key
    // ============================================
    const agePrivateKey = 'AGE-SECRET-KEY-15HLU3CZEGE53RQ8CXT0S0CPTM00J5Y6T263JXVY58ZC5C5TVWWKQW05F79';
    const ageKeyParameter = new ssm.StringParameter(this, 'AgePrivateKeyParameter', {
      parameterName: '/influxdb/age-private-key',
      stringValue: agePrivateKey,
    });

    // ============================================
    // Decrypt secrets at synthesis time (for demo purposes)
    // ============================================
    // In production, this should be done in Lambda at runtime
    const decryptedSecrets = {
      influxDbToken: 'my-super-secret-auth-token', // This would be decrypted from secrets.yaml
      influxDbOrg: 'myorg',
      influxDbBucket: 'mybucket',
    };

    // ============================================
    // Security Groups
    // ============================================
    const securityGroups = new SecurityGroupsConstruct(this, 'SecurityGroups', { vpc });
    const albSecurityGroup = securityGroups.albSecurityGroup;
    const lambdaSecurityGroup = securityGroups.lambdaSecurityGroup;
    const influxDbSecurityGroup = securityGroups.influxDbSecurityGroup;

    // ============================================
    // InfluxDB EC2 Instance
    // ============================================
    const influxDbInstanceConstruct = new InfluxDbInstanceConstruct(this, 'InfluxDbConstruct', {
      vpc,
      securityGroup: influxDbSecurityGroup,
    });

    const influxDbInstance = influxDbInstanceConstruct.instance;

    // ============================================
    // Lambda CRUD Service
    // ============================================
    const lambdaCrudApi = new LambdaCrudApiConstruct(this, 'LambdaCrud', {
      vpc,
      securityGroup: lambdaSecurityGroup,
      influxDbPrivateIp: influxDbInstance.instancePrivateIp,
      influxDbToken: decryptedSecrets.influxDbToken,
      influxDbOrg: decryptedSecrets.influxDbOrg,
      influxDbBucket: decryptedSecrets.influxDbBucket,
    });

    const crudLambda = lambdaCrudApi.lambdaFunction;

    // ============================================
    // Application Load Balancer
    // ============================================
    const loadBalancer = new LoadBalancerConstruct(this, 'LoadBalancer', {
      vpc,
      securityGroup: albSecurityGroup,
      lambdaFunction: crudLambda,
    });

    const alb = loadBalancer.alb;

    // ============================================
    // CloudWatch Alarms for Observability
    // ============================================
    const monitoring = new MonitoringConstruct(this, 'Monitoring', {
      influxDbInstance,
      alb,
      lambdaFunction: crudLambda,
    });

    // ============================================
    // CloudFormation Outputs
    // ============================================
    
    new cdk.CfnOutput(this, 'ALBDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'DNS name of the Application Load Balancer',
      exportName: 'ALBDnsName',
    });

    new cdk.CfnOutput(this, 'InfluxDbPrivateIp', {
      value: influxDbInstance.instancePrivateIp,
      description: 'Private IP address of InfluxDB instance',
      exportName: 'InfluxDbPrivateIp',
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
      exportName: 'VpcId',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'API endpoint URL for CRUD operations',
      exportName: 'ApiEndpoint',
    });
  }
}
