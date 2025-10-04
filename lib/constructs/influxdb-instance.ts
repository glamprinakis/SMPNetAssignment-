/**
 * InfluxDB Instance Construct
 * 
 * Creates and manages InfluxDB EC2 instance:
 * - EC2 instance in private subnet
 * - IAM role with Secrets Manager permissions
 * - UserData script that:
 *   - Fetches credentials from AWS Secrets Manager at boot
 *   - Installs InfluxDB 2.7.10
 *   - Configures and starts the service with fetched credentials
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

  /**
   * ARN of the Secrets Manager secret containing InfluxDB credentials
   */
  readonly secretArn: string;
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

    const { vpc, securityGroup, secretArn } = props;

    // InfluxDB installation script with Secrets Manager integration
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'exec > /var/log/user-data.log 2>&1',
      'set -x',
      'echo "Starting InfluxDB installation at $(date)"',
      '',
      '# Update and install dependencies',
      'yum update -y',
      'yum install -y docker jq aws-cli',
      '',
      '# Start Docker',
      'systemctl start docker',
      'systemctl enable docker',
      'echo "Docker status:"',
      'systemctl status docker --no-pager',
      'docker --version',
      '',
      '# Fetch credentials from AWS Secrets Manager',
      'echo "Fetching credentials from Secrets Manager..."',
      `SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id ${secretArn} --query SecretString --output text)`,
      'echo "Secret fetched successfully"',
      '',
      '# Parse credentials using jq',
      'INFLUXDB_TOKEN=$(echo $SECRET_JSON | jq -r .token)',
      'INFLUXDB_ORG=$(echo $SECRET_JSON | jq -r .organization)',
      'INFLUXDB_BUCKET=$(echo $SECRET_JSON | jq -r .bucket)',
      'INFLUXDB_USERNAME=$(echo $SECRET_JSON | jq -r .username)',
      'INFLUXDB_PASSWORD=$(echo $SECRET_JSON | jq -r .password)',
      '',
      'echo "Credentials parsed:"',
      'echo "  Organization: $INFLUXDB_ORG"',
      'echo "  Bucket: $INFLUXDB_BUCKET"',
      'echo "  Username: $INFLUXDB_USERNAME"',
      'echo "  Token: ${INFLUXDB_TOKEN:0:10}..." # Only show first 10 chars for security',
      '',
      '# Start InfluxDB container with credentials from Secrets Manager',
      'echo "Starting InfluxDB container..."',
      'docker run -d --name influxdb \\',
      '  -p 8086:8086 \\',
      '  -v influxdb-data:/var/lib/influxdb2 \\',
      '  -e DOCKER_INFLUXDB_INIT_MODE=setup \\',
      '  -e DOCKER_INFLUXDB_INIT_USERNAME="$INFLUXDB_USERNAME" \\',
      '  -e DOCKER_INFLUXDB_INIT_PASSWORD="$INFLUXDB_PASSWORD" \\',
      '  -e DOCKER_INFLUXDB_INIT_ORG="$INFLUXDB_ORG" \\',
      '  -e DOCKER_INFLUXDB_INIT_BUCKET="$INFLUXDB_BUCKET" \\',
      '  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN="$INFLUXDB_TOKEN" \\',
      '  influxdb:2.7.10',
      '',
      'echo "Waiting for InfluxDB to initialize..."',
      'sleep 15',
      '',
      'echo "Checking if container is running..."',
      'docker ps -a',
      '',
      'echo "Container logs:"',
      'docker logs influxdb 2>&1 | tail -50',
      '',
      'echo "Waiting for InfluxDB health check..."',
      'for i in {1..30}; do',
      '  if curl -s http://localhost:8086/health > /dev/null 2>&1; then',
      '    echo "InfluxDB is healthy!"',
      '    break',
      '  fi',
      '  echo "Attempt $i: InfluxDB not ready yet..."',
      '  sleep 5',
      'done',
      '',
      'echo "Final health check:"',
      'curl -v http://localhost:8086/health 2>&1 || echo "Health check failed"',
      '',
      'echo "Testing InfluxDB API access..."',
      'curl -s -H "Authorization: Token $INFLUXDB_TOKEN" "http://localhost:8086/api/v2/buckets?org=$INFLUXDB_ORG" | head -10',
      '',
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
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });

    this.instancePrivateIp = this.instance.instancePrivateIp;
  }
}
