/**
 * Load Balancer Construct
 * 
 * Creates and manages Application Load Balancer infrastructure:
 * - Internet-facing ALB in public subnets
 * - HTTP listener on port 80
 * - Lambda target group with health checks
 * - Lambda invocation permissions for ALB
 * 
 * Exported Resources:
 * - alb: The Application Load Balancer
 * - listener: The HTTP listener
 * - targetGroup: The Lambda target group
 */

import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';

export interface LoadBalancerConstructProps {
  /**
   * The VPC to deploy the load balancer in
   */
  readonly vpc: ec2.IVpc;

  /**
   * Security group for the ALB
   */
  readonly securityGroup: ec2.ISecurityGroup;

  /**
   * Lambda function to target
   */
  readonly lambdaFunction: lambda.IFunction;

  /**
   * Health check path (default: /health)
   */
  readonly healthCheckPath?: string;

  /**
   * Health check interval in seconds (default: 30)
   */
  readonly healthCheckIntervalSeconds?: number;
}

export class LoadBalancerConstruct extends Construct {
  /**
   * The Application Load Balancer
   */
  public readonly alb: elbv2.ApplicationLoadBalancer;

  /**
   * The HTTP listener
   */
  public readonly listener: elbv2.ApplicationListener;

  /**
   * The Lambda target group
   */
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: LoadBalancerConstructProps) {
    super(scope, id);

    const { vpc, securityGroup, lambdaFunction, healthCheckPath = '/health', healthCheckIntervalSeconds = 30 } = props;

    // Create Application Load Balancer
    this.alb = new elbv2.ApplicationLoadBalancer(scope, 'CrudApiALB', {
      vpc,
      internetFacing: true,
      securityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Create Lambda target
    const lambdaTarget = new elbv2_targets.LambdaTarget(lambdaFunction);

    // Create target group for Lambda
    this.targetGroup = new elbv2.ApplicationTargetGroup(scope, 'LambdaTargetGroup', {
      targets: [lambdaTarget],
      healthCheck: {
        enabled: true,
        path: healthCheckPath,
        interval: cdk.Duration.seconds(healthCheckIntervalSeconds),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // Create HTTP listener on port 80
    this.listener = this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.forward([this.targetGroup]),
    });

    // Grant Lambda permission to be invoked by ALB
    lambdaFunction.grantInvoke(new iam.ServicePrincipal('elasticloadbalancing.amazonaws.com'));
  }
}
