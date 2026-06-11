using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Micelio.Api.Features.Auth;

/// <summary>
/// Genera JWT de acceso (corta duración) y refresh tokens opacos (HU-32).
/// El refresh token viaja en cookie HttpOnly y se guarda hasheado (SHA-256).
/// </summary>
public sealed class TokenService(IConfiguration config)
{
    public int AccessTokenMinutes { get; } = int.TryParse(config["Jwt:AccessTokenMinutes"], out var m) ? m : 15;
    public int RefreshTokenDays { get; } = int.TryParse(config["Jwt:RefreshTokenDays"], out var d) ? d : 7;

    private readonly string _secret = config["Jwt:Secret"]
        ?? throw new InvalidOperationException("Falta configurar Jwt:Secret.");

    private readonly string _issuer = config["Jwt:Issuer"] ?? "micelio";

    public string CreateAccessToken(string userId, string email, string nombre)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _issuer,
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, userId),
                new Claim(JwtRegisteredClaimNames.Email, email),
                new Claim("nombre", nombre),
            ],
            expires: DateTime.UtcNow.AddMinutes(AccessTokenMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>Token opaco aleatorio (valor para la cookie) + su hash (para la DB).</summary>
    public static (string Token, string Hash) CreateOpaqueToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(48);
        var token = Convert.ToBase64String(bytes)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        return (token, HashToken(token));
    }

    public static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
