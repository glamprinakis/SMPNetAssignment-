/**
 * Security Groups Construct
 * 
 * Creates and manages security groups for the infrastructure:
 * - ALB Security Group: Allows HTTP traffic from internet
 * - Lambda Security Group: Allows all outbound traffic
 * - InfluxDB Security Group: Allows InfluxDB access from Lambda only
 * 
 * Exported Resources:
 * - albSecurityGroup: Security group for Application Load Balancer
 * - lambdaSecurityGroup: Security group for Lambda functions
 * - influxDbSecurityGroup: Security group for InfluxDB EC2 instance
 */

import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface SecurityGroupsConstructProps {
  /**
   * The VPC to create security groups in
   */
  readonly vpc: ec2.IVpc;
}

export class SecurityGroupsConstruct extends Construct {
  /**
   * Security group for Application Load Balancer
   */
  public readonly albSecurityGroup: ec2.SecurityGroup;

  /**
   * Security group for Lambda functions
   */
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  /**
   * Security group for InfluxDB EC2 instance
   */
  public readonly influxDbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: SecurityGroupsConstructProps) {
    super(scope, id);

    const { vpc } = props;

    // Security Group for ALB (preserving logical ID)
    this.albSecurityGroup = new ec2.SecurityGroup(scope, 'ALBSecurityGroup', {
      vpc,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: true,
    });

    // Allow HTTP traffic from anywhere to ALB
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );

    // Security Group for Lambda CRUD Service (preserving logical ID)
    this.lambdaSecurityGroup = new ec2.SecurityGroup(scope, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda CRUD service',
      allowAllOutbound: true,
    });

    // Security Group for InfluxDB EC2 Instance (preserving logical ID)
    this.influxDbSecurityGroup = new ec2.SecurityGroup(scope, 'InfluxDbSecurityGroup', {
      vpc,
      description: 'Security group for InfluxDB EC2 instance',
      allowAllOutbound: true,
    });

    // Allow InfluxDB traffic from Lambda security group
    this.influxDbSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(8086),
      'Allow InfluxDB access from Lambda CRUD service'
    );
  }
}
