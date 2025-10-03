/**
 * Monitoring Construct
 * 
 * Creates and manages CloudWatch alarms for infrastructure monitoring:
 * - EC2 CPU utilization alarm for InfluxDB instance
 * - ALB target response time alarm
 * - Lambda error rate alarm
 * 
 * Exported Resources:
 * - cpuAlarm: EC2 CPU utilization alarm
 * - responseTimeAlarm: ALB response time alarm
 * - lambdaErrorAlarm: Lambda error rate alarm
 */

import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cdk from 'aws-cdk-lib';

export interface MonitoringConstructProps {
  /**
   * InfluxDB EC2 instance to monitor
   */
  readonly influxDbInstance: ec2.IInstance;

  /**
   * Application Load Balancer to monitor
   */
  readonly alb: elbv2.ApplicationLoadBalancer;

  /**
   * Lambda function to monitor
   */
  readonly lambdaFunction: lambda.IFunction;

  /**
   * CPU alarm threshold percentage (default: 80)
   */
  readonly cpuThreshold?: number;

  /**
   * Response time alarm threshold in seconds (default: 1)
   */
  readonly responseTimeThreshold?: number;

  /**
   * Lambda error threshold (default: 5)
   */
  readonly lambdaErrorThreshold?: number;
}

export class MonitoringConstruct extends Construct {
  /**
   * EC2 CPU utilization alarm
   */
  public readonly cpuAlarm: cloudwatch.Alarm;

  /**
   * ALB response time alarm
   */
  public readonly responseTimeAlarm: cloudwatch.Alarm;

  /**
   * Lambda error rate alarm
   */
  public readonly lambdaErrorAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: MonitoringConstructProps) {
    super(scope, id);

    const {
      influxDbInstance,
      alb,
      lambdaFunction,
      cpuThreshold = 80,
      responseTimeThreshold = 1,
      lambdaErrorThreshold = 5,
    } = props;

    // CPU Utilization Alarm for InfluxDB Instance
    const cpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensionsMap: {
        InstanceId: influxDbInstance.instanceId,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    this.cpuAlarm = new cloudwatch.Alarm(scope, 'InfluxDbCpuAlarm', {
      metric: cpuMetric,
      threshold: cpuThreshold,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ALB Target Response Time Alarm
    const responseTimeMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'TargetResponseTime',
      dimensionsMap: {
        LoadBalancer: alb.loadBalancerFullName,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    this.responseTimeAlarm = new cloudwatch.Alarm(scope, 'ALBResponseTimeAlarm', {
      metric: responseTimeMetric,
      threshold: responseTimeThreshold,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Lambda Error Rate Alarm
    this.lambdaErrorAlarm = new cloudwatch.Alarm(scope, 'LambdaErrorAlarm', {
      metric: lambdaFunction.metricErrors(),
      threshold: lambdaErrorThreshold,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
