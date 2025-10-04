/**
 * InfluxDB Instance Construct
 * 
 * Creates and manages InfluxDB EC2 instance:
 * - EC2 instance in private subnet
 * - IAM role with SSM permissions
 * - UserData script that:
 *   - Installs InfluxDB 2.7.10
 *   - Configures and starts the service
 *   - Initializes with hardcoded credentials (for demo/assignment purposes)
 *   - Includes error handling with CloudWatch logging
 * 
 * Exported Resources:
 * - instance: The EC2 instance
 * - instancePrivateIp: Private IP address of the instance
 */

import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface InfluxDbInstanceConstructProps {
  /**
   * The VPC to launch the instance in
   */
  readonly vpc: ec2.IVpc;

  /**
   * Security group for the instance
   */
  readonly securityGroup: ec2.ISecurityGroup;
}

export class InfluxDbInstanceConstruct extends Construct {
  /**
   * The EC2 instance running InfluxDB
   */
  public readonly instance: ec2.Instance;

  /**
   * Private IP address of the InfluxDB instance
   */
  public readonly instancePrivateIp: string;

  constructor(scope: Construct, id: string, props: InfluxDbInstanceConstructProps) {
    super(scope, id);

    const { vpc, securityGroup } = props;

    // IAM Role for InfluxDB EC2 Instance (created at parent scope to preserve logical ID)
    const influxDbRole = new iam.Role(scope, 'InfluxDbEC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'IAM role for InfluxDB EC2 instance',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Hardcoded credentials for simplicity
    const ADMIN_PASSWORD = 'adminpassword123';
    const AUTH_TOKEN = 'my-super-secret-auth-token';
    const ORG = 'myorg';
    const BUCKET = 'mybucket';

    // InfluxDB installation script
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'exec > /var/log/user-data.log 2>&1',
      'set -x',
      'echo "Starting InfluxDB installation at $(date)"',
      'yum update -y',
      'yum install -y docker',
      'systemctl start docker',
      'systemctl enable docker',
      'echo "Docker status:"',
      'systemctl status docker --no-pager',
      'docker --version',
      'echo "Starting InfluxDB container..."',
      'docker run -d --name influxdb -p 8086:8086 \\',
      '  -e DOCKER_INFLUXDB_INIT_MODE=setup \\',
      '  -e DOCKER_INFLUXDB_INIT_USERNAME=admin \\',
      '  -e DOCKER_INFLUXDB_INIT_PASSWORD=adminpassword123 \\',
      '  -e DOCKER_INFLUXDB_INIT_ORG=myorg \\',
      '  -e DOCKER_INFLUXDB_INIT_BUCKET=mybucket \\',
      '  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=my-super-secret-auth-token \\',
      '  influxdb:2.7.10',
      'echo "Waiting for InfluxDB to initialize..."',
      'sleep 15',
      'echo "Checking if container is running..."',
      'docker ps -a',
      'echo "Container logs:"',
      'docker logs influxdb 2>&1 | tail -50',
      'echo "Waiting for InfluxDB health check..."',
      'for i in {1..30}; do',
      '  if curl -s http://localhost:8086/health > /dev/null 2>&1; then',
      '    echo "InfluxDB is healthy!"',
      '    break',
      '  fi',
      '  echo "Attempt $i: InfluxDB not ready yet..."',
      '  sleep 5',
      'done',
      'echo "Final health check:"',
      'curl -v http://localhost:8086/health 2>&1 || echo "Health check failed"',
      'echo "Testing InfluxDB API access..."',
      'curl -s -H "Authorization: Token my-super-secret-auth-token" "http://localhost:8086/api/v2/buckets?org=myorg" | head -10',
      'echo "Installation complete at $(date)"'
    );

    // Select Amazon Linux 2023 AMI
    const machineImage = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    // Create InfluxDB EC2 instance (created at parent scope to preserve logical ID)
    this.instance = new ec2.Instance(scope, 'InfluxDbInstance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage,
      securityGroup,
      userData,
      associatePublicIpAddress: false,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP2,
            encrypted: false,
          }),
        },
      ],
    });

    this.instancePrivateIp = this.instance.instancePrivateIp;
  }
}
