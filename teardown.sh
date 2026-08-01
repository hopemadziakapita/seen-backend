#!/usr/bin/env bash
# Deletes every resource created by deploy-dev.sh or deploy-production.sh in
# one shot (the resource group and everything inside it). Irreversible —
# double-check RESOURCE_GROUP first.
#
# NOTE: If tearing down a production deployment, the Application Gateway can
# take 5-10 minutes to deprovision. The --no-wait flag means this script
# returns immediately, but the actual deletion continues in the background.
set -euo pipefail

echo "Available resource groups to tear down:"
echo "  1) seen-backend-rg       (dev deployment)"
echo "  2) seen-backend-prod-rg  (production deployment)"
echo
read -r -p "Enter the resource group name to delete: " RESOURCE_GROUP

if [ -z "$RESOURCE_GROUP" ]; then
  echo "No resource group specified. Aborting."
  exit 1
fi

echo
echo "This will permanently delete resource group '$RESOURCE_GROUP' and everything in it."
read -r -p "Type the resource group name again to confirm: " CONFIRM
if [ "$CONFIRM" != "$RESOURCE_GROUP" ]; then
  echo "Confirmation did not match. Aborting."
  exit 1
fi

az group delete --name "$RESOURCE_GROUP" --yes --no-wait
echo "Deletion started (--no-wait). Check status with: az group show --name $RESOURCE_GROUP"
