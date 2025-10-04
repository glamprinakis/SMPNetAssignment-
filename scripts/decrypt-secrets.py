#!/usr/bin/env python3
"""
Script to decrypt secrets from secrets.yaml using SOPS and store them in AWS SSM Parameter Store.
This should be run before CDK deployment.

Usage:
    python3 scripts/decrypt-secrets.py
"""

import subprocess
import json
import boto3
import sys
from pathlib import Path

def decrypt_secrets():
    """Decrypt secrets.yaml using SOPS."""
    try:
        # Run SOPS decrypt command
        result = subprocess.run(
            ['sops', '--decrypt', 'secrets.yaml'],
            capture_output=True,
            text=True,
            check=True
        )
        
        # Parse the decrypted YAML (convert to JSON for easier parsing)
        import yaml
        secrets = yaml.safe_load(result.stdout)
        return secrets
    except subprocess.CalledProcessError as e:
        print(f"Error decrypting secrets: {e.stderr}", file=sys.stderr)
        sys.exit(1)
    except ImportError:
        print("PyYAML is required. Install with: pip install pyyaml", file=sys.stderr)
        sys.exit(1)

def store_in_ssm(secrets):
    """Store decrypted secrets in AWS SSM Parameter Store."""
    ssm = boto3.client('ssm')
    
    # Extract InfluxDB secrets
    influxdb_secrets = secrets.get('influxdb', {})
    
    parameters = {
        '/influxdb/admin-password': influxdb_secrets.get('admin_password', 'adminpassword123'),
        '/influxdb/auth-token': influxdb_secrets.get('auth_token', 'my-super-secret-auth-token'),
        '/influxdb/organization': influxdb_secrets.get('organization', 'myorg'),
        '/influxdb/bucket': influxdb_secrets.get('bucket', 'mybucket'),
    }
    
    for param_name, param_value in parameters.items():
        try:
            # Try to update existing parameter
            ssm.put_parameter(
                Name=param_name,
                Value=str(param_value),
                Type='SecureString',
                Overwrite=True,
                Description=f'InfluxDB secret managed by SOPS'
            )
            print(f"✓ Stored {param_name}")
        except Exception as e:
            print(f"✗ Failed to store {param_name}: {e}", file=sys.stderr)
            sys.exit(1)

def main():
    """Main function."""
    print("🔓 Decrypting secrets from secrets.yaml...")
    secrets = decrypt_secrets()
    
    print("\n📦 Storing secrets in AWS SSM Parameter Store...")
    store_in_ssm(secrets)
    
    print("\n✅ All secrets successfully stored in SSM Parameter Store")
    print("You can now run: npm run deploy")

if __name__ == '__main__':
    main()
