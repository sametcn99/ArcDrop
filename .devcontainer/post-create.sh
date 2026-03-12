#!/usr/bin/env bash

set -euo pipefail

repo_root="/workspaces/ArcDrop"
env_example_path="${repo_root}/ops/docker/.env.example"
env_target_path="${repo_root}/ops/docker/.env"

generate_hex_secret() {
    local bytes="$1"

    # Prefer OpenSSL when available because it is present in the base image and produces deterministic ASCII output.
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex "${bytes}" | tr -d '\n'
        return
    fi

    head -c "${bytes}" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

replace_or_append_env_value() {
    local key="$1"
    local value="$2"
    local escaped_value

    escaped_value=$(printf '%s' "${value}" | sed -e 's/[\/&]/\\&/g')

    if grep -q "^${key}=" "${env_target_path}"; then
        sed -i "s/^${key}=.*/${key}=${escaped_value}/" "${env_target_path}"
        return
    fi

    printf '\n%s=%s\n' "${key}" "${value}" >> "${env_target_path}"
}

if [ ! -f "${env_target_path}" ]; then
    cp "${env_example_path}" "${env_target_path}"

    # The generated values are intentionally local-only so debug sessions work without committing secrets.
    postgres_password="devcontainer-$(generate_hex_secret 8)"
    admin_password="DevContainer!$(generate_hex_secret 4)"
    jwt_signing_key="$(generate_hex_secret 48)"
    connection_string="Host=postgres;Port=5432;Database=arcdrop;Username=arcdrop;Password=${postgres_password}"

    replace_or_append_env_value "ARCDROP_POSTGRES_PASSWORD" "${postgres_password}"
    replace_or_append_env_value "ARCDROP_ADMIN_PASSWORD" "${admin_password}"
    replace_or_append_env_value "ARCDROP_JWT_SIGNING_KEY" "${jwt_signing_key}"
    replace_or_append_env_value "ARCDROP_API_ENVIRONMENT" "Development"
    replace_or_append_env_value "ARCDROP_ConnectionStrings__ArcDropPostgres" "${connection_string}"
fi

# Restore command-line tools and solution packages once so the container is ready for build, test, and debug loops.
if [ -f "${repo_root}/dotnet-tools.json" ]; then
    dotnet tool restore
fi

dotnet restore "${repo_root}/ArcDrop.slnx"
