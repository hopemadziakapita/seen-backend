#!/usr/bin/env bash
# Deletes every resource created by deploy.sh in one shot (the resource group
# and everything inside it). Irreversible — double-check RESOURCE_GROUP first.
set -euo pipefail

RESOURCE_GROUP="seen-backend-rg"

echo "This will permanently delete resource group '$RESOURCE_GROUP' and everything in it."
read -r -p "Type the resource group name to confirm: " CONFIRM
if [ "$CONFIRM" != "$RESOURCE_GROUP" ]; then
  echo "Confirmation did not match. Aborting."
  exit 1
fi

az group delete --name "$RESOURCE_GROUP" --yes --no-wait
echo "Deletion started (--no-wait). Check status with: az group show --name $RESOURCE_GROUP"
