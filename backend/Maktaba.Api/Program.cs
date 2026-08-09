using System.Net;

var builder = WebApplication.CreateBuilder(args);

var port = builder.Configuration.GetValue<int?>("port") ?? 51000;
var token = builder.Configuration.GetValue<string?>("token");

builder.WebHost.ConfigureKestrel(options =>
{
    options.Listen(IPAddress.Loopback, port);
});

var app = builder.Build();

// Bearer-token auth for every route except the unauthenticated health check.
// Token is generated per-launch by the Electron main process and passed via --token;
// running the API directly (no --token) skips auth, which is convenient for local dev/testing.
app.Use(async (context, next) =>
{
    if (context.Request.Path == "/health" || string.IsNullOrEmpty(token))
    {
        await next();
        return;
    }

    if (context.Request.Headers.Authorization.ToString() != $"Bearer {token}")
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    await next();
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/hello", () => Results.Ok(new { message = "Hello from Maktaba.Api" }));

app.Run();
