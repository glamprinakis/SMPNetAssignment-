/**
 * Lambda CRUD API Construct
 * 
 * Creates and manages Lambda function for CRUD operations on InfluxDB:
 * - Lambda function with Python 3.11 runtime
 * - UV-based dependency bundling
 * - VPC configuration for private subnet deployment
 * - Environment variables for InfluxDB connection
 * - IAM role with Secrets Manager read permissions
 * 
 * Exported Resources:
 * - lambdaFunction: The Lambda function for CRUD operations
 */

import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cdk from 'aws-cdk-lib';

export interface LambdaCrudApiConstructProps {
  /**
   * The VPC to deploy the Lambda function in
   */
  readonly vpc: ec2.IVpc;

  /**
   * Security group for the Lambda function
   */
  readonly securityGroup: ec2.ISecurityGroup;

  /**
   * Private IP address of the InfluxDB instance
   */
  readonly influxDbPrivateIp: string;

  /**
   * ARN of the Secrets Manager secret containing InfluxDB credentials
   */
  readonly secretArn: string;
}

export class LambdaCrudApiConstruct extends Construct {
  /**
   * The Lambda function for CRUD operations
   */
  public readonly lambdaFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaCrudApiConstructProps) {
    super(scope, id);

    const { vpc, securityGroup, influxDbPrivateIp, secretArn } = props;

    // IAM Role for Lambda (created at parent scope to preserve logical ID)
    const lambdaRole = new iam.Role(scope, 'LambdaCrudRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Lambda CRUD service with Secrets Manager access',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Create Lambda function with UV-based dependencies
    // Note: UV bundling happens during deployment via pyproject.toml
    // Note: Secrets Manager read permission is granted in the main stack
    this.lambdaFunction = new lambda.Function(scope, 'CrudLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [securityGroup],
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      environment: {
        INFLUXDB_URL: `http://${influxDbPrivateIp}:8086`,
        INFLUXDB_SECRET_ARN: secretArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
  }
}
