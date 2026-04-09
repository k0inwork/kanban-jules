#!/bin/bash
# Script to install git and pull a repository
# Usage: ./setup-and-pull.sh <repo-url> <target-directory>

REPO_URL=$1
TARGET_DIR=$2

if [ -z "$REPO_URL" ] || [ -z "$TARGET_DIR" ]; then
  echo "Usage: ./setup-and-pull.sh <repo-url> <target-directory>"
  exit 1
fi

# Install git if not present
if ! command -v git &> /dev/null; then
  echo "Git not found. Installing..."
  if [ -x "$(command -v apt-get)" ]; then
    sudo apt-get update && sudo apt-get install -y git
  elif [ -x "$(command -v brew)" ]; then
    brew install git
  else
    echo "Could not install git automatically. Please install git manually."
    exit 1
  fi
fi

# Pull or Clone
if [ -d "$TARGET_DIR" ]; then
  echo "Directory exists. Pulling..."
  cd "$TARGET_DIR" && git pull
else
  echo "Cloning..."
  git clone "$REPO_URL" "$TARGET_DIR"
fi
