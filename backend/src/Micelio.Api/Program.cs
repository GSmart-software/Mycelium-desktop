var builder = WebApplication.CreateBuilder(args);

const string FrontendCors = "frontend";

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCors, policy => policy
        .WithOrigins(builder.Configuration["Cors:FrontendOrigin"] ?? "http://localhost:3000")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

var app = builder.Build();

app.UseCors(FrontendCors);

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    storageProvider = app.Configuration["Storage:Provider"] ?? "cloudflare"
}));

app.Run();
