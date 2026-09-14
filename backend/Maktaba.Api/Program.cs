using System.Net;
using Maktaba.Api.Endpoints;
using Maktaba.Core.Services;
using Maktaba.Data;
using Maktaba.Data.Services;
using Maktaba.Metadata;

var builder = WebApplication.CreateBuilder(args);

var port = builder.Configuration.GetValue<int?>("port") ?? 51000;
var token = builder.Configuration.GetValue<string?>("token");

builder.WebHost.ConfigureKestrel(options =>
{
    options.Listen(IPAddress.Loopback, port);
});

// Default is 5s - bumped a little so CloudSyncLifecycleService.StopAsync's own best-effort push
// (see below, and POST /shutdown) has a realistic chance to actually finish against a slow/far-away
// cloud endpoint before the host gives up on graceful shutdown and moves on regardless.
builder.Host.ConfigureHostOptions(options => options.ShutdownTimeout = TimeSpan.FromSeconds(10));

builder.Services.AddCors(options =>
{
    // Loopback-only server behind a per-launch bearer token (see below), so any origin is fine here -
    // the renderer's origin differs from the API's in both dev (Vite on :5173) and packaged (file://) builds.
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

builder.Services.AddSingleton<LibraryService>();
builder.Services.AddSingleton<ILibraryService>(sp => sp.GetRequiredService<LibraryService>());
builder.Services.AddSingleton<ILibraryPathProvider>(sp => sp.GetRequiredService<LibraryService>());

builder.Services.AddSingleton<LocalFileSystemProvider>();
builder.Services.AddSingleton<IStorageProviderFactory, StorageProviderFactory>();
builder.Services.AddSingleton<ICloudCacheManager, CloudCacheManager>();
builder.Services.AddSingleton<ISyncStatusTracker, SyncStatusTracker>();
builder.Services.AddSingleton<ICloudCredentialCache, CloudCredentialCache>();
builder.Services.AddSingleton<ILibraryMigrationService, LibraryMigrationService>();
builder.Services.AddHostedService<Maktaba.Api.CloudSyncLifecycleService>();

builder.Services.AddScoped(sp => MaktabaDbContextFactory.Create(sp.GetRequiredService<ILibraryPathProvider>()));

builder.Services.AddSingleton<IBookMetadataExtractor, EpubMetadataExtractor>();
builder.Services.AddSingleton<IBookMetadataExtractor, PdfMetadataExtractor>();
builder.Services.AddSingleton<IBookMetadataExtractor, DocxMetadataExtractor>();
builder.Services.AddSingleton<IBookMetadataExtractor, TxtMetadataExtractor>();
builder.Services.AddSingleton<IBookTextContentExtractor, DocxTextContentExtractor>();
builder.Services.AddSingleton<IBookTextContentExtractor, TxtTextContentExtractor>();
builder.Services.AddScoped<IImportService, ImportService>();
builder.Services.AddScoped<IBookEditService, BookEditService>();
builder.Services.AddScoped<IAuthorRenameService, AuthorRenameService>();
builder.Services.AddScoped<IBookRemovalService, BookRemovalService>();
builder.Services.AddScoped<ILibraryRescanService, LibraryRescanService>();
builder.Services.AddSingleton<IRescanProgressTracker, RescanProgressTracker>();
builder.Services.AddSingleton<ICalibreConverter, CalibreConverter>();
builder.Services.AddScoped<IBookConversionService, BookConversionService>();
builder.Services.AddScoped<IPeriodicalService, PeriodicalService>();

// Issue #24: Open Library's free public API, standing in for Goodreads (whose API has had no
// new-consumer access since 2020) - see IMetadataLookupService's doc comment. A descriptive
// User-Agent is requested by Open Library's API etiquette guidelines.
builder.Services.AddHttpClient<IMetadataLookupService, OpenLibraryMetadataLookupService>(client =>
{
    client.DefaultRequestHeaders.UserAgent.ParseAdd("Maktaba/1.0 (+https://github.com/inshapardaz/maktaba)");
    client.Timeout = TimeSpan.FromSeconds(10);
});

var app = builder.Build();

app.UseCors();

// Bearer-token auth for every route except the unauthenticated health check.
// Token is generated per-launch by the Electron main process and passed via --token;
// running the API directly (no --token) skips auth, which is convenient for local dev/testing.
// A ?access_token= query param is also accepted, since <img> tags can't set an Authorization
// header - used only for GET /api/books/{id}/cover.
app.Use(async (context, next) =>
{
    if (context.Request.Path == "/health" || string.IsNullOrEmpty(token))
    {
        await next();
        return;
    }

    var viaHeader = context.Request.Headers.Authorization.ToString() == $"Bearer {token}";
    var viaQuery = context.Request.Query["access_token"].ToString() == token;

    if (!viaHeader && !viaQuery)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    await next();
});

// A library must be opened (POST /api/libraries/open) before any endpoint that resolves
// MaktabaDbContext will work; surface that as a 400 instead of an unhandled 500. Also transparently
// rebuilds metadata.db (and rescans to repopulate it) if it predates a breaking schema change - see
// LibraryService.EnsureCurrentSchemaAsync.
app.Use(async (context, next) =>
{
    try
    {
        var libraryService = context.RequestServices.GetRequiredService<LibraryService>();
        if (await libraryService.EnsureCurrentSchemaAsync(context.RequestAborted))
        {
            await context.RequestServices.GetRequiredService<ILibraryRescanService>()
                .RescanAsync(context.RequestAborted);
        }

        await next();
    }
    catch (LibraryNotOpenException ex)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { error = ex.Message });
    }
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// Lets the Electron main process request a graceful shutdown before actually killing this process
// - see sidecar.ts's stopSidecarGracefully. StopApplication() runs every IHostedService's own
// StopAsync (in particular CloudSyncLifecycleService's best-effort push of the active library's
// metadata.db) before the process exits. Without this, the OS-level kill Electron would otherwise
// use directly gives the .NET generic host no such chance on Windows: Node's child.kill() calls
// TerminateProcess there (not a real signal a process can react to, unlike a POSIX SIGTERM), so
// that safety-net push was silently never running at all when the app closed.
app.MapPost("/shutdown", (IHostApplicationLifetime lifetime) =>
{
    lifetime.StopApplication();
    return Results.Accepted();
});

app.MapGet("/api/hello", () => Results.Ok(new { message = "Hello from Maktaba.Api" }));

app.MapLibraryEndpoints();
app.MapBookEndpoints();
app.MapBrowseEndpoints();
app.MapCollectionEndpoints();
app.MapSystemEndpoints();
app.MapReaderDataEndpoints();
app.MapAuthorEndpoints();
app.MapTagEndpoints();
app.MapSeriesEndpoints();
app.MapPeriodicalEndpoints();
app.MapMetadataEndpoints();
app.MapAnalyticsEndpoints();

app.Run();
