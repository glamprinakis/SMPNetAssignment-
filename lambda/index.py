"""
Lambda function for CRUD operations on InfluxDB time-series data.

Endpoints:
- POST /data - Create new data point
- GET /data - Retrieve all data points
- PUT /data/:id - Update data point by ID
- DELETE /data/:id - Delete data point by ID
- GET /health - Health check endpoint
"""

import json
import os
import urllib3
from datetime import datetime

# InfluxDB configuration from environment variables
INFLUXDB_URL = os.environ.get('INFLUXDB_URL', 'http://localhost:8086')
INFLUXDB_TOKEN = os.environ.get('INFLUXDB_TOKEN')
INFLUXDB_ORG = os.environ.get('INFLUXDB_ORG', 'myorg')
INFLUXDB_BUCKET = os.environ.get('INFLUXDB_BUCKET', 'mybucket')

http = urllib3.PoolManager()


def write_data(measurement, tags, fields):
    """Write data to InfluxDB using Line Protocol."""
    # Build line protocol string
    tag_str = ','.join([f"{k}={v}" for k, v in tags.items()])
    field_str = ','.join([f"{k}={v}" for k, v in fields.items()])
    line_protocol = f"{measurement},{tag_str} {field_str}"
    
    url = f"{INFLUXDB_URL}/api/v2/write?org={INFLUXDB_ORG}&bucket={INFLUXDB_BUCKET}&precision=ns"
    headers = {
        'Authorization': f'Token {INFLUXDB_TOKEN}',
        'Content-Type': 'text/plain; charset=utf-8'
    }
    
    response = http.request(
        'POST',
        url,
        body=line_protocol.encode('utf-8'),
        headers=headers
    )
    
    return response.status == 204


def query_data(query_str):
    """Query data from InfluxDB using Flux query language."""
    url = f"{INFLUXDB_URL}/api/v2/query?org={INFLUXDB_ORG}"
    headers = {
        'Authorization': f'Token {INFLUXDB_TOKEN}',
        'Content-Type': 'application/vnd.flux',
        'Accept': 'application/json'
    }
    
    response = http.request(
        'POST',
        url,
        body=query_str.encode('utf-8'),
        headers=headers
    )
    
    if response.status == 200:
        # Parse CSV response from InfluxDB
        data = response.data.decode('utf-8')
        return parse_influxdb_response(data)
    
    return None


def parse_influxdb_response(csv_data):
    """Parse InfluxDB CSV response into JSON format."""
    lines = csv_data.strip().splitlines()
    if len(lines) < 2:
        return []
    
    # Skip metadata rows and get header
    data_lines = [line.strip() for line in lines if line.strip() and not line.startswith('#')]
    if len(data_lines) < 2:
        return []
    
    headers = [h.strip() for h in data_lines[0].split(',')]
    result = []
    
    for line in data_lines[1:]:
        values = [v.strip() for v in line.split(',')]
        row = dict(zip(headers, values))
        result.append(row)
    
    return result


def delete_data(measurement, tag_key, tag_value, start_time, stop_time):
    """Delete data from InfluxDB using delete predicate."""
    url = f"{INFLUXDB_URL}/api/v2/delete?org={INFLUXDB_ORG}&bucket={INFLUXDB_BUCKET}"
    headers = {
        'Authorization': f'Token {INFLUXDB_TOKEN}',
        'Content-Type': 'application/json'
    }
    
    predicate = f'_measurement="{measurement}" AND {tag_key}="{tag_value}"'
    
    delete_body = {
        'start': start_time,
        'stop': stop_time,
        'predicate': predicate
    }
    
    response = http.request(
        'POST',
        url,
        body=json.dumps(delete_body).encode('utf-8'),
        headers=headers
    )
    
    return response.status == 204


def handler(event, context):
    """Lambda handler for ALB target."""
    print(f"Event: {json.dumps(event)}")
    
    # Parse request from ALB
    http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method', 'GET')
    path = event.get('path', '/')
    body = event.get('body', '{}')
    
    # Parse body if it's a string
    if isinstance(body, str):
        try:
            body = json.loads(body) if body else {}
        except json.JSONDecodeError:
            body = {}
    
    # Health check endpoint
    if path == '/health':
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'status': 'healthy', 'timestamp': datetime.utcnow().isoformat()})
        }
    
    # Route requests
    try:
        if path == '/data' and http_method == 'POST':
            # Create new data point
            measurement = body.get('measurement', 'sensor_data')
            tags = body.get('tags', {'sensor_id': 'default'})
            fields = body.get('fields', {'value': 0})
            
            success = write_data(measurement, tags, fields)
            
            if success:
                return {
                    'statusCode': 201,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'message': 'Data created successfully'})
                }
            else:
                return {
                    'statusCode': 500,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'error': 'Failed to write data'})
                }
        
        elif path == '/data' and http_method == 'GET':
            # Retrieve all data points
            query = f'''
            from(bucket: "{INFLUXDB_BUCKET}")
              |> range(start: -7d)
              |> limit(n: 100)
            '''
            
            data = query_data(query)
            
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'data': data or []})
            }
        
        elif path.startswith('/data/') and http_method == 'PUT':
            # Update data point (InfluxDB is append-only, so we write new data)
            data_id = path.split('/')[-1]
            measurement = body.get('measurement', 'sensor_data')
            tags = body.get('tags', {'sensor_id': data_id})
            fields = body.get('fields', {'value': 0})
            
            success = write_data(measurement, tags, fields)
            
            if success:
                return {
                    'statusCode': 200,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'message': f'Data {data_id} updated successfully'})
                }
            else:
                return {
                    'statusCode': 500,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'error': 'Failed to update data'})
                }
        
        elif path.startswith('/data/') and http_method == 'DELETE':
            # Delete data point
            data_id = path.split('/')[-1]
            
            # Delete data from last 30 days with matching sensor_id tag
            start_time = '1970-01-01T00:00:00Z'
            stop_time = datetime.utcnow().isoformat() + 'Z'
            
            success = delete_data('sensor_data', 'sensor_id', data_id, start_time, stop_time)
            
            if success:
                return {
                    'statusCode': 200,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'message': f'Data {data_id} deleted successfully'})
                }
            else:
                return {
                    'statusCode': 500,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'error': 'Failed to delete data'})
                }
        
        else:
            return {
                'statusCode': 404,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Not found'})
            }
    
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': f'Internal server error: {str(e)}'})
        }
