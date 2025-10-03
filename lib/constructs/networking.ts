/**
 * Networking Construct
 * 
 * Creates and manages VPC networking infrastructure including:
 * - VPC with configurable CIDR
 * - Public and private subnets across multiple availability zones
 * - Internet Gateway for public subnet internet access
 * - NAT Gateway for private subnet outbound connectivity
 * - Route tables for public and private subnets
 * 
 * Exported Resources:
 * - vpc: The VPC instance
 * - publicSubnets: Array of public subnets
 * - privateSubnets: Array of private subnets
 */

import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface NetworkingConstructProps {
  /**
   * Maximum number of availability zones to use
   * @default 2
   */
  readonly maxAzs?: number;

  /**
   * Number of NAT Gateways to create
   * @default 1
   */
  readonly natGateways?: number;

  /**
   * CIDR mask for subnets
   * @default 24
   */
  readonly cidrMask?: number;
}

export class NetworkingConstruct extends Construct {
  /**
   * The VPC instance
   */
  public readonly vpc: ec2.Vpc;

  /**
   * Public subnets
   */
  public readonly publicSubnets: ec2.ISubnet[];

  /**
   * Private subnets with egress
   */
  public readonly privateSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props?: NetworkingConstructProps) {
    super(scope, id);

    const maxAzs = props?.maxAzs ?? 2;
    const natGateways = props?.natGateways ?? 1;
    const cidrMask = props?.cidrMask ?? 24;

    // Create VPC with public and private subnets
    this.vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs,
      natGateways,
      subnetConfiguration: [
        {
          cidrMask,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Extract subnet references for convenience
    this.publicSubnets = this.vpc.publicSubnets;
    this.privateSubnets = this.vpc.privateSubnets;
  }
}
