using Maktaba.Api.Dtos;
using Maktaba.Core.Services;

namespace Maktaba.Api.Endpoints;

/// <summary>Machine-level capabilities the frontend needs to know about up front (e.g. to grey out
/// a control rather than let the user hit a 503 after already filling out a form).</summary>
public static class SystemEndpoints
{
    public static void MapSystemEndpoints(this WebApplication app)
    {
        app.MapGet("/api/system/capabilities", (IBookConversionService conversionService) =>
            Results.Ok(new SystemCapabilitiesDto(conversionService.IsAvailable)));
    }
}
