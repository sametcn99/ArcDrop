FROM mcr.microsoft.com/dotnet/sdk:10.0

# Install database inspection utilities used during local backend development and troubleshooting.
RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends jq postgresql-client sudo \
    && echo "ubuntu ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
