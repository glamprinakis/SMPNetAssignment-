/**
 * Unit tests for MonitoringConstruct
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { MonitoringConstruct } from '../../lib/constructs/monitoring';

describe('MonitoringConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let instance: ec2.Instance;
  let alb: elbv2.ApplicationLoadBalancer;
  let lambdaFunction: lambda.Function;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack');
    vpc = new ec2.Vpc(stack, 'TestVPC');
    
    instance = new ec2.Instance(stack, 'TestInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
    });

    alb = new elbv2.ApplicationLoadBalancer(stack, 'TestALB', {
      vpc,
      internetFacing: true,
    });

    lambdaFunction = new lambda.Function(stack, 'TestFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromInline('def handler(event, context): return {"statusCode": 200}'),
    });
  });

  test('creates three CloudWatch alarms', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
  });

  test('creates CPU utilization alarm with correct configuration', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'CPUUtilization',
      Namespace: 'AWS/EC2',
      Threshold: 80,
      EvaluationPeriods: 2,
      DatapointsToAlarm: 2,
      Statistic: 'Average',
    });
  });

  test('creates ALB response time alarm with correct configuration', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'TargetResponseTime',
      Namespace: 'AWS/ApplicationELB',
      Threshold: 1,
      EvaluationPeriods: 2,
      DatapointsToAlarm: 2,
      Statistic: 'Average',
    });
  });

  test('creates Lambda error alarm with correct configuration', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Errors',
      Namespace: 'AWS/Lambda',
      Threshold: 5,
      EvaluationPeriods: 1,
    });
  });

  test('uses custom CPU threshold when provided', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
      cpuThreshold: 90,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'CPUUtilization',
      Threshold: 90,
    });
  });

  test('uses custom response time threshold when provided', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
      responseTimeThreshold: 2,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'TargetResponseTime',
      Threshold: 2,
    });
  });

  test('uses custom Lambda error threshold when provided', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
      lambdaErrorThreshold: 10,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Errors',
      Threshold: 10,
    });
  });

  test('CPU alarm monitors correct instance', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'CPUUtilization',
      Dimensions: Match.arrayWith([
        Match.objectLike({
          Name: 'InstanceId',
          Value: Match.objectLike({
            Ref: Match.stringLikeRegexp('TestInstance'),
          }),
        }),
      ]),
    });
  });

  test('response time alarm monitors correct ALB', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'TargetResponseTime',
      Dimensions: Match.arrayWith([
        Match.objectLike({
          Name: 'LoadBalancer',
        }),
      ]),
    });
  });

  test('Lambda error alarm monitors correct function', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Errors',
      Dimensions: Match.arrayWith([
        Match.objectLike({
          Name: 'FunctionName',
          Value: Match.objectLike({
            Ref: Match.stringLikeRegexp('TestFunction'),
          }),
        }),
      ]),
    });
  });

  test('all alarms treat missing data as NOT_BREACHING', () => {
    new MonitoringConstruct(stack, 'TestMonitoring', {
      influxDbInstance: instance,
      alb,
      lambdaFunction,
    });

    const template = Template.fromStack(stack);
    const json = template.toJSON();
    const alarms = Object.values(json.Resources).filter(
      (resource: any) => resource.Type === 'AWS::CloudWatch::Alarm'
    );

    expect(alarms).toHaveLength(3);
    alarms.forEach((alarm: any) => {
      expect(alarm.Properties.TreatMissingData).toBe('notBreaching');
    });
  });
});
