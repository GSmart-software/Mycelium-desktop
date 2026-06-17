# Imagen del backend .NET 9 para Render.
# El build context es la carpeta backend/ (render.yaml usa rootDir: backend).

# ---- build ----
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
# Restore primero (capa cacheable) y luego publish.
COPY src/Micelio.Api/Micelio.Api.csproj src/Micelio.Api/
RUN dotnet restore src/Micelio.Api/Micelio.Api.csproj
COPY src/ src/
RUN dotnet publish src/Micelio.Api/Micelio.Api.csproj -c Release -o /app /p:UseAppHost=false

# ---- runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime

# Chromium del sistema para PuppeteerSharp (export PDF, HU-10). Evita la
# descarga en runtime: PdfService usa PUPPETEER_EXECUTABLE_PATH si está presente.
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
        libpango-1.0-0 libasound2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY --from=build /app .

ENV ASPNETCORE_ENVIRONMENT=Production
# Render inyecta la variable PORT; Program.cs la lee y ata Kestrel a ese puerto.
EXPOSE 10000
ENTRYPOINT ["dotnet", "Micelio.Api.dll"]
