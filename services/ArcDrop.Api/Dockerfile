# Build stage: compile and publish the API with deterministic output path.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy the full repository because the API project depends on shared package projects.
COPY . .

# Restore and publish only the API entry project to keep the final runtime image small.
RUN dotnet restore ./services/ArcDrop.Api/ArcDrop.Api.csproj
RUN dotnet publish ./services/ArcDrop.Api/ArcDrop.Api.csproj -c Release -o /app/publish --no-restore

# Runtime stage: run the published output on the ASP.NET runtime image.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# Container listens on port 8080 to simplify host-port mapping in compose stacks.
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "ArcDrop.Api.dll"]
