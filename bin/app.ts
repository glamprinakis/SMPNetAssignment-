#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfluxDbCrudStack } from '../lib/influxdb-crud-stack';

const app = new cdk.App();

new InfluxDbCrudStack(app, 'InfluxDbCrudStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-central-1', // Default to eu-central-1 if not set
  },
  description: 'Private InfluxDB with CRUD API behind Application Load Balancer',
});

app.synth();
