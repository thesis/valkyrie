#!/bin/bash
set -e

# node
echo "Installing node..."
brew list node &>/dev/null || brew install node

echo "Installing precommit requirements..."
brew list pre-commit &>/dev/null || brew install pre-commit
# run pre-commit install
echo "Installing pre-commit and specified hooks..."
pre-commit install --install-hooks
