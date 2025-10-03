import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class InfluxDbCrudStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================
    // VPC with Public/Private Subnets across 2 AZs
    // ============================================
    const vpc = new ec2.Vpc(this, 'InfluxDbVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // ============================================
    // Security Groups
    // ============================================
    
    // Security Group for ALB
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: true,
    });
    
    // Allow HTTP traffic from anywhere to ALB
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );

    // Security Group for Lambda CRUD Service
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda CRUD service',
      allowAllOutbound: true,
    });

    // Security Group for InfluxDB EC2 Instance
    const influxDbSecurityGroup = new ec2.SecurityGroup(this, 'InfluxDbSecurityGroup', {
      vpc,
      description: 'Security group for InfluxDB EC2 instance',
      allowAllOutbound: true,
    });

    // Allow InfluxDB traffic from Lambda security group
    influxDbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(8086),
      'Allow InfluxDB access from Lambda CRUD service'
    );

    // ============================================
    // IAM Role for InfluxDB EC2 Instance
    // ============================================
    const influxDbRole = new iam.Role(this, 'InfluxDbEC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'IAM role for InfluxDB EC2 instance',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // ============================================
    // InfluxDB EC2 Instance
    // ============================================
    
    // User data script to install and configure InfluxDB
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -ex',
      '',
      '# Update system',
      'yum update -y',
      '',
      '# Install InfluxDB 2.x',
      'wget https://dl.influxdata.com/influxdb/releases/influxdb2-2.7.10_linux_amd64.tar.gz',
      'tar xvzf influxdb2-2.7.10_linux_amd64.tar.gz',
      'cp influxdb2-2.7.10/usr/bin/influxd /usr/local/bin/',
      'cp influxdb2-2.7.10/usr/bin/influx /usr/local/bin/',
      '',
      '# Create InfluxDB directories',
      'mkdir -p /var/lib/influxdb2',
      'mkdir -p /etc/influxdb2',
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
      '# Setup InfluxDB (initial user, org, bucket)',
      'influx setup --username admin --password adminpassword123 --org myorg --bucket mybucket --token my-super-secret-auth-token --force',
      '',
      '# Install CloudWatch agent',
      'wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm',
      'rpm -U ./amazon-cloudwatch-agent.rpm',
      '',
      'echo "InfluxDB installation complete"'
    );

    // Select Amazon Linux 2023 AMI
    const machineImage = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    // Create InfluxDB EC2 instance in private subnet
    const influxDbInstance = new ec2.Instance(this, 'InfluxDbInstance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage,
      securityGroup: influxDbSecurityGroup,
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

    // ============================================
    // Lambda CRUD Service
    // ============================================
    
    // IAM Role for Lambda
    const lambdaRole = new iam.Role(this, 'LambdaCrudRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Lambda CRUD service',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Create Lambda function for CRUD operations
    const crudLambda = new lambda.Function(this, 'CrudLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      environment: {
        INFLUXDB_URL: `http://${influxDbInstance.instancePrivateIp}:8086`,
        INFLUXDB_TOKEN: 'my-super-secret-auth-token',
        INFLUXDB_ORG: 'myorg',
        INFLUXDB_BUCKET: 'mybucket',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // ============================================
    // Application Load Balancer
    // ============================================
    
    const alb = new elbv2.ApplicationLoadBalancer(this, 'CrudApiALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Create target group for Lambda
    const lambdaTarget = new elbv2_targets.LambdaTarget(crudLambda);

    // Create listener on port 80
    const listener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.forward([
        new elbv2.ApplicationTargetGroup(this, 'LambdaTargetGroup', {
          targets: [lambdaTarget],
          healthCheck: {
            enabled: true,
            path: '/health',
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(10),
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 3,
          },
        }),
      ]),
    });

    // Grant Lambda permission to be invoked by ALB
    crudLambda.grantInvoke(new iam.ServicePrincipal('elasticloadbalancing.amazonaws.com'));

    // ============================================
    // CloudWatch Alarms for Observability
    // ============================================
    
    // CPU Utilization Alarm for InfluxDB Instance
    const cpuMetric = new cdk.aws_cloudwatch.Metric({
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensionsMap: {
        InstanceId: influxDbInstance.instanceId,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });
    
    const cpuAlarm = new cdk.aws_cloudwatch.Alarm(this, 'InfluxDbCpuAlarm', {
      metric: cpuMetric,
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ALB Target Response Time Alarm
    const responseTimeMetric = new cdk.aws_cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'TargetResponseTime',
      dimensionsMap: {
        LoadBalancer: alb.loadBalancerFullName,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });
    
    const responseTimeAlarm = new cdk.aws_cloudwatch.Alarm(this, 'ALBResponseTimeAlarm', {
      metric: responseTimeMetric,
      threshold: 1,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Lambda Error Rate Alarm
    const lambdaErrorAlarm = new cdk.aws_cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      metric: crudLambda.metricErrors(),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
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
