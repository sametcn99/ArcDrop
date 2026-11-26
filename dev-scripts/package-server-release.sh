#!/usr/bin/env bash
set -euo pipefail

tag=$1
arch=$2
bundle="ArcDrop-$tag-server-linux-$arch"
stage=$(mktemp -d)
folder="$stage/$bundle"
mkdir -p "$folder" release-assets

bun -e '
  const [tag, dir] = process.argv.slice(1);
  const config = Bun.YAML.parse(await Bun.file("compose.yaml").text());
  for (const service of ["web", "api"]) {
    delete config.services[service].build;
    config.services[service].image = `arcdrop/${service}:${tag}`;
  }
  await Bun.write(`${dir}/compose.yaml`, Bun.YAML.stringify(config, null, 2) + "\n");
  console.log(config.services.db.image);
' "$tag" "$folder" > "$stage/database-image"
db_image=$(cat "$stage/database-image")
cp LICENSE .env.example "$folder/"
cat > "$folder/README.md" <<'DOC'
# ArcDrop self-hosted server

The archive includes prebuilt ArcDrop web and API container images, PostgreSQL and a Compose configuration. Use Docker with the Compose plugin on a host that matches the package architecture.

1. Run `docker load --input images.tar` in this directory.
2. Copy `.env.example` to `.env`. Set an independent random value for each of `ARCDROP__JWT__SECRET` and `ARCDROP__TOTP__ENCRYPTION_KEY`. Generate them with `openssl rand -hex 32`. Set a PostgreSQL password for a fresh deployment.
3. Run `docker compose up -d --pull never --wait`.
4. Open [ArcDrop setup](http://127.0.0.1:3000/bootstrap) and create the administrator account.

The published port binds to loopback by default. To serve other devices, configure a TLS reverse proxy and set `ARCDROP__PUBLIC__BASE_URL` to the public origin. See the [backup and upgrade guide](https://github.com/sametcn99/ArcDrop/blob/main/apps/api/docs/backup-restore.md).
DOC

for service in api web; do
  docker build --file "apps/$service/Dockerfile" --tag "arcdrop/$service:$tag" .
done
docker pull "$db_image"
docker save -o "$folder/images.tar" "arcdrop/api:$tag" "arcdrop/web:$tag" "$db_image"

# Exercise installation from the packaged images and Compose file.
docker image rm "arcdrop/api:$tag" "arcdrop/web:$tag" "$db_image"
docker load --input "$folder/images.tar"
export ARCDROP__JWT__SECRET=$(openssl rand -hex 32)
export ARCDROP__TOTP__ENCRYPTION_KEY=$(openssl rand -hex 32)
export POSTGRES_PASSWORD=$(openssl rand -hex 24)
compose=(docker compose --project-name arcdrop-release-smoke --file "$folder/compose.yaml")
trap '"${compose[@]}" down --volumes --remove-orphans' EXIT
"${compose[@]}" up -d --pull never --wait --wait-timeout 180
curl -fsS http://127.0.0.1:3000/api/v1/readyz
curl -fsS http://127.0.0.1:3000/api/v1/healthz | jq --exit-status --arg version "${tag#v}" '.status == "ok" and .version == $version'
curl -fsS http://127.0.0.1:3000/bootstrap > "$stage/web.html"
grep -F '<title>ArcDrop' "$stage/web.html"

tar -C "$stage" -czf "release-assets/$bundle.tar.gz" "$bundle"
