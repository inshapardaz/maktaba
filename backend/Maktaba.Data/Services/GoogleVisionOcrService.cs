using System.Text;
using System.Text.Json;
using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

public class GoogleVisionOcrService(HttpClient httpClient) : IGoogleVisionOcrService
{
    private const string Endpoint = "https://vision.googleapis.com/v1/images:annotate";

    public async Task<string> RecognizeTextAsync(byte[] imageBytes, string apiKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("No Google Vision API key configured - add one in Settings.");
        }

        var requestBody = new
        {
            requests = new[]
            {
                new
                {
                    image = new { content = Convert.ToBase64String(imageBytes) },
                    // DOCUMENT_TEXT_DETECTION (not plain TEXT_DETECTION) - tuned for a dense page of
                    // text rather than short signage-style strings.
                    features = new[] { new { type = "DOCUMENT_TEXT_DETECTION" } },
                },
            },
        };

        using var content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json");
        using var response = await httpClient.PostAsync($"{Endpoint}?key={Uri.EscapeDataString(apiKey)}", content, ct);
        var responseJson = await response.Content.ReadAsStringAsync(ct);

        using var document = JsonDocument.Parse(responseJson);
        var root = document.RootElement;

        if (!response.IsSuccessStatusCode)
        {
            var message = root.TryGetProperty("error", out var error) && error.TryGetProperty("message", out var msg)
                ? msg.GetString()
                : $"Google Vision request failed ({(int)response.StatusCode}).";
            throw new InvalidOperationException(message);
        }

        var firstResponse = root.GetProperty("responses")[0];
        if (firstResponse.TryGetProperty("error", out var responseError))
        {
            var message = responseError.TryGetProperty("message", out var msg) ? msg.GetString() : "Google Vision returned an error.";
            throw new InvalidOperationException(message);
        }

        return firstResponse.TryGetProperty("fullTextAnnotation", out var annotation) && annotation.TryGetProperty("text", out var text)
            ? text.GetString() ?? ""
            : "";
    }
}
