# =============================================================================
# AbrIT CMS — Orchard Core 3.x (the REAL administration CMS at /admin)
#
# Multi-stage build:
#   build  : .NET 10 SDK — `dotnet publish` of AbrITPortal + both AbrIT themes
#   runner : ASP.NET Core 10 runtime, plain HTTP on 0.0.0.0:5000
#            (TLS terminates at the outer proxy / the Next.js portal proxy)
#
# First run: Orchard's normal secure setup flow — open /admin (through the
# portal proxy) and confirm the PostgreSQL connection that docker-compose
# pre-fills. Never bake a default administrator password into the image;
# use the documented operator bootstrap (see docs/DEPLOYMENT.md) when needed.
# =============================================================================

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY AbrITPortal.slnx ./
COPY AbrITPortal ./AbrITPortal/
COPY AbrITAdminTheme ./AbrITAdminTheme/
COPY AbrITPortalTheme ./AbrITPortalTheme/

RUN dotnet publish AbrITPortal/AbrITPortal.csproj \
    -c Release \
    -o /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runner
WORKDIR /app

# curl: container healthcheck; gosu: drop root after preparing persisted volumes
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gosu \
    && groupadd --system --gid 10001 abrit \
    && useradd --system --uid 10001 --gid abrit --home-dir /app --no-create-home abrit \
    && rm -rf /var/lib/apt/lists/*

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://0.0.0.0:5000

COPY --from=build /app/publish .
# Empty source directories are omitted by dotnet publish. Create the web root
# in the final image and fail the build if it is ever absent.
RUN mkdir -p /app/wwwroot /app/App_Data \
    /var/lib/abrit-portal/imagesharp-cache \
    /var/lib/abrit-portal/data-protection-keys \
    && test -d /app/wwwroot
COPY --chmod=0755 docker/cms-entrypoint.sh /usr/local/bin/cms-entrypoint

# Orchard runtime state (tenants, media, uploaded content) survives restarts
VOLUME /app/App_Data

EXPOSE 5000
ENTRYPOINT ["cms-entrypoint"]
CMD ["dotnet", "AbrITPortal.dll"]
