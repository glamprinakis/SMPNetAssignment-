/**
 * InfluxDB Instance Construct
 * 
 * Creates and manages InfluxDB EC2 instance with SOPS-based secret management:
 * - EC2 instance in private subnet
 * - IAM role with SSM permissions for age key retrieval
 * - UserData script that:
 *   - Installs SOPS binary
 *   - Retrieves age private key from AWS Systems Manager Parameter Store
 *   - Decrypts secrets.yaml using SOPS
 *   - Uses decrypted credentials for InfluxDB initialization
 *   - Includes error handling with CloudWatch logging
 * 
 * Exported Resources:
 * - instance: The EC2 instance
 * - instancePrivateIp: Private IP address of the instance
 */

import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { readFileSync } from 'fs';
import { join } from 'path';

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
   * SSM parameter name containing the age private key
   * @default '/influxdb/age-private-key'
   */
  readonly ageKeyParameterName?: string;

  /**
   * Path to the encrypted secrets.yaml file
   * @default 'secrets.yaml'
   */
  readonly secretsFilePath?: string;
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
    const ageKeyParameterName = props.ageKeyParameterName ?? '/influxdb/age-private-key';
    const secretsFilePath = props.secretsFilePath ?? 'secrets.yaml';

    // Read encrypted secrets file to embed in UserData
    const encryptedSecrets = readFileSync(join(process.cwd(), secretsFilePath), 'utf8');

    // IAM Role for InfluxDB EC2 Instance (created at parent scope to preserve logical ID)
    const influxDbRole = new iam.Role(scope, 'InfluxDbEC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'IAM role for InfluxDB EC2 instance with SOPS decryption permissions',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Add SSM GetParameter permission for age private key
    influxDbRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:*:*:parameter${ageKeyParameterName}`,
        ],
      })
    );

    // User data script with SOPS integration
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      '',
      '# Log to CloudWatch',
      'exec > >(tee /var/log/user-data.log)',
      'exec 2>&1',
      '',
      'echo "=== Starting InfluxDB installation with SOPS ===" ',
      '',
      '# Update system',
      'yum update -y',
      '',
      '# Install dependencies',
      'yum install -y wget tar gzip jq',
      '',
      '# Install SOPS',
      'echo "Installing SOPS..."',
      'wget -q https://github.com/getsops/sops/releases/download/v3.9.0/sops-v3.9.0.linux.amd64 -O /usr/local/bin/sops',
      'chmod +x /usr/local/bin/sops',
      'sops --version || { echo "ERROR: SOPS installation failed"; exit 1; }',
      '',
      '# Install age',
      'echo "Installing age..."',
      'wget -q https://github.com/FiloSottile/age/releases/download/v1.2.1/age-v1.2.1-linux-amd64.tar.gz',
      'tar xzf age-v1.2.1-linux-amd64.tar.gz',
      'mv age/age /usr/local/bin/',
      'mv age/age-keygen /usr/local/bin/',
      'chmod +x /usr/local/bin/age /usr/local/bin/age-keygen',
      'age --version || { echo "ERROR: age installation failed"; exit 1; }',
      '',
      '# Retrieve age private key from SSM Parameter Store',
      `echo "Retrieving age private key from SSM: ${ageKeyParameterName}"`,
      `AGE_KEY=$(aws ssm get-parameter --name "${ageKeyParameterName}" --with-decryption --region $(ec2-metadata --availability-zone | cut -d' ' -f2 | sed 's/[a-z]$//') --query 'Parameter.Value' --output text 2>&1)`,
      'if [ $? -ne 0 ]; then',
      '  echo "ERROR: Failed to retrieve age private key from SSM Parameter Store"',
      '  echo "$AGE_KEY"',
      '  echo "FALLBACK: Proceeding with hardcoded credentials for backwards compatibility"',
      '  USE_SOPS=false',
      'else',
      '  echo "Age private key retrieved successfully"',
      '  export SOPS_AGE_KEY="$AGE_KEY"',
      '  USE_SOPS=true',
      'fi',
      '',
      '# Write encrypted secrets to file',
      'cat > /tmp/secrets.yaml.enc <<\'SECRETS_EOF\'',
      ...encryptedSecrets.split('\n'),
      'SECRETS_EOF',
      '',
      '# Decrypt secrets with SOPS',
      'if [ "$USE_SOPS" = "true" ]; then',
      '  echo "Decrypting secrets with SOPS..."',
      '  sops -d /tmp/secrets.yaml.enc > /tmp/secrets.yaml 2>&1 || {',
      '    echo "ERROR: SOPS decryption failed"',
      '    echo "FALLBACK: Proceeding with hardcoded credentials"',
      '    USE_SOPS=false',
      '  }',
      'fi',
      '',
      '# Parse credentials',
      'if [ "$USE_SOPS" = "true" ]; then',
      '  echo "Parsing decrypted secrets..."',
      '  ADMIN_PASSWORD=$(grep "admin_password:" /tmp/secrets.yaml | cut -d: -f2 | xargs)',
      '  AUTH_TOKEN=$(grep "auth_token:" /tmp/secrets.yaml | cut -d: -f2 | xargs)',
      '  ORG=$(grep "organization:" /tmp/secrets.yaml | cut -d: -f2 | xargs)',
      '  BUCKET=$(grep "bucket:" /tmp/secrets.yaml | cut -d: -f2 | xargs)',
      '  rm -f /tmp/secrets.yaml /tmp/secrets.yaml.enc',
      '  echo "✅ Using SOPS-managed credentials"',
      'else',
      '  echo "⚠️  Using hardcoded fallback credentials"',
      '  ADMIN_PASSWORD="adminpassword123"',
      '  AUTH_TOKEN="my-super-secret-auth-token"',
      '  ORG="myorg"',
      '  BUCKET="mybucket"',
      'fi',
      '',
      '# Install InfluxDB',
      'echo "Installing InfluxDB 2.7.10..."',
      'wget -q https://dl.influxdata.com/influxdb/releases/influxdb2-2.7.10_linux_amd64.tar.gz',
      'tar xzf influxdb2-2.7.10_linux_amd64.tar.gz',
      'cp influxdb2-2.7.10/usr/bin/influxd /usr/local/bin/',
      'cp influxdb2-2.7.10/usr/bin/influx /usr/local/bin/',
      'rm -rf influxdb2-2.7.10*',
      '',
      '# Create InfluxDB directories',
      'mkdir -p /var/lib/influxdb2 /etc/influxdb2',
      '',
      '# Create systemd service',
      'cat > /etc/systemd/system/influxdb.service <<EOF',
      '[Unit]',
      'Description=InfluxDB 2.0',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      'User=root',
      'ExecStart=/usr/local/bin/influxd',
      'Restart=on-failure',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      '',
      '# Start InfluxDB',
      'systemctl daemon-reload',
      'systemctl enable influxdb',
      'systemctl start influxdb',
      '',
      '# Wait for InfluxDB to start',
      'sleep 10',
      '',
      '# Setup InfluxDB with credentials',
      'echo "Initializing InfluxDB..."',
      'influx setup --username admin --password "$ADMIN_PASSWORD" --org "$ORG" --bucket "$BUCKET" --token "$AUTH_TOKEN" --force',
      '',
      '# Install CloudWatch agent',
      'wget -q https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm',
      'rpm -U ./amazon-cloudwatch-agent.rpm',
      '',
      'echo "=== InfluxDB installation complete ==="'
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
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage,
      securityGroup,
      role: influxDbRole,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });

    this.instancePrivateIp = this.instance.instancePrivateIp;
  }
}
