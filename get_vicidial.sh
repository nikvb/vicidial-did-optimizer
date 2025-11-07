#!/bin/bash

# Define the target directory relative to the current working directory
TARGET_DIR="./astguiclient"
REPO_URL="svn://svn.eflo.net:3690/agc_2-X/trunk"

echo "Starting Vicidial SVN retrieval script..."

# 1. Check for Subversion installation and install if necessary
if ! command -v svn &> /dev/null
then
    echo "Subversion is not installed. Installing now..."
    # Ensure package lists are up to date
    sudo apt update
    # Install the subversion client
    sudo apt install -y subversion
    if [ $? -eq 0 ]; then
        echo "Subversion installed successfully."
    else
        echo "Failed to install Subversion. Exiting script."
        exit 1
    fi
else
    echo "Subversion is already installed."
fi

# 2. Create the target directory if it doesn't exist
if [ ! -d "$TARGET_DIR" ]; then
    echo "Creating directory: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
else
    echo "Directory $TARGET_DIR already exists. Proceeding with checkout."
fi

# 3. Change directory and check out the SVN repository
cd "$TARGET_DIR" || { echo "Could not change directory to $TARGET_DIR. Exiting."; exit 1; }

echo "Checking out Vicidial source code from $REPO_URL into the current directory..."
# Use "svn checkout ." to download directly into the current directory (astguiclient)
svn checkout "$REPO_URL" .

if [ $? -eq 0 ]; then
    echo "----------------------------------------------------"
    echo "Vicidial SVN checkout completed successfully."
    echo "The source code is located in: $(pwd)"
    echo "You can proceed with installation steps, typically starting with 'perl install.pl' inside this directory."
    echo "----------------------------------------------------"
else
    echo "----------------------------------------------------"
    echo "SVN checkout failed. Check network connection and permissions."
    echo "----------------------------------------------------"
fi

