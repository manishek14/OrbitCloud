using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using OrchardCore.Users;
using OrchardCore.Users.Indexes;
using OrchardCore.Users.Models;
using YesSql;

namespace AbrITPortal.Mobile;

public enum OtpPurpose { Registration, VerifyMobile, Recovery }
public sealed record OtpIssue(string ChallengeId, bool Accepted);
public sealed record OtpResult(bool Succeeded, string? Authorization = null);
internal sealed class OtpChallenge
{
    public required OtpPurpose Purpose { get; init; }
    public required string Mobile { get; init; }
    public required string UserId { get; init; }
    public required string Username { get; init; }
    public required string ProtectedPassword { get; init; }
    public required byte[] Salt { get; init; }
    public required byte[] Hash { get; init; }
    public required DateTimeOffset Expires { get; init; }
    public int Attempts { get; set; }
}
internal sealed record ResetGrant(string UserId, byte[] TokenHash, int Version, DateTimeOffset Expires);

public sealed class MobileIdentityService(
    IMemoryCache cache,
    UserManager<IUser> users,
    YesSql.ISession session,
    ISmsProvider sms,
    IDataProtectionProvider protection)
{
    private static readonly object Gate = new();
    private readonly IDataProtector _protector = protection.CreateProtector("AbrIT.MobilePendingRegistration.v1");

    public static string? NormalizeIranianMobile(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var digits = new StringBuilder();
        foreach (var c in input.Trim())
        {
            if (c is >= '0' and <= '9') digits.Append(c);
            else if (c is >= '۰' and <= '۹') digits.Append((char)('0' + c - '۰'));
            else if (c is >= '٠' and <= '٩') digits.Append((char)('0' + c - '٠'));
            else if (c is ' ' or '-' or '(' or ')' or '+') continue;
            else return null;
        }
        var value = digits.ToString();
        if (value.StartsWith("0098")) value = value[4..];
        else if (value.StartsWith("98")) value = value[2..];
        else if (value.StartsWith("0")) value = value[1..];
        return Regex.IsMatch(value, "^9[0-9]{9}$") ? "+98" + value : null;
    }

    public async Task<OtpIssue> BeginRegistrationAsync(string username, string password, string mobile, string ip)
    {
        var normalized = NormalizeIranianMobile(mobile);
        if (normalized is null || string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            return new("", false);
        if (!Rate(ip, "registration:" + username.ToUpperInvariant())) return new("", false);
        if (await users.FindByNameAsync(username) is not null || await VerifiedMobileExistsAsync(normalized))
            return new("", false);
        return await IssueAsync(OtpPurpose.Registration, normalized, "", username, _protector.Protect(password));
    }

    public async Task<OtpResult> CompleteRegistrationAsync(string id, string code)
    {
        var challenge = Consume(id, code, OtpPurpose.Registration);
        if (challenge is null) return new(false);
        if (await users.FindByNameAsync(challenge.Username) is not null ||
            await VerifiedMobileExistsAsync(challenge.Mobile)) return new(false);
        var user = new User
        {
            UserName = challenge.Username,
            PhoneNumber = challenge.Mobile,
            PhoneNumberConfirmed = true,
            IsEnabled = true
        };
        var result = await users.CreateAsync(user, _protector.Unprotect(challenge.ProtectedPassword));
        if (!result.Succeeded) return new(false);
        var role = await users.AddToRoleAsync(user, "Customer");
        if (!role.Succeeded)
        {
            await users.DeleteAsync(user);
            return new(false);
        }
        return new(true);
    }

    public async Task<OtpIssue> BeginMobileVerificationAsync(IUser account, string mobile, string ip)
    {
        var normalized = NormalizeIranianMobile(mobile);
        if (normalized is null || !Rate(ip, "mobile:" + await users.GetUserIdAsync(account)) ||
            await VerifiedMobileExistsAsync(normalized, await users.GetUserIdAsync(account)))
            return new("", false);
        return await IssueAsync(OtpPurpose.VerifyMobile, normalized, await users.GetUserIdAsync(account), "", "");
    }

    public async Task<OtpResult> CompleteMobileVerificationAsync(IUser account, string id, string code)
    {
        var challenge = Consume(id, code, OtpPurpose.VerifyMobile);
        if (challenge is null || challenge.UserId != await users.GetUserIdAsync(account) ||
            await VerifiedMobileExistsAsync(challenge.Mobile, challenge.UserId)) return new(false);
        if (account is not User user) return new(false);
        user.PhoneNumber = challenge.Mobile;
        user.PhoneNumberConfirmed = true;
        return new((await users.UpdateAsync(user)).Succeeded);
    }

    public async Task<OtpIssue> BeginRecoveryAsync(string usernameOrMobile, string ip)
    {
        var lookup = usernameOrMobile?.Trim() ?? "";
        var mobile = NormalizeIranianMobile(lookup);
        var account = mobile is null ? await users.FindByNameAsync(lookup) : await FindByVerifiedMobileAsync(mobile);
        var accountId = account is null ? "" : await users.GetUserIdAsync(account);
        var id = RandomId();
        if (!Rate(ip, "recovery:" + (accountId.Length == 0 ? lookup.ToUpperInvariant() : accountId)))
            return new(id, true); // Identical response for unknown and limited accounts.
        if (account is User user && user.PhoneNumberConfirmed &&
            NormalizeIranianMobile(user.PhoneNumber) is string verified)
            return await IssueAsync(OtpPurpose.Recovery, verified, accountId, "", "");
        return new(id, true);
    }

    public OtpResult VerifyRecovery(string id, string code)
    {
        var challenge = Consume(id, code, OtpPurpose.Recovery);
        if (challenge is null || string.IsNullOrWhiteSpace(challenge.UserId)) return new(false);
        var token = RandomId();
        lock (Gate)
        {
            var version = cache.Get<int>("recovery-version:" + challenge.UserId);
            cache.Set("reset:" + token, new ResetGrant(challenge.UserId,
                SHA256.HashData(Encoding.UTF8.GetBytes(token)), version,
                DateTimeOffset.UtcNow.AddMinutes(5)), TimeSpan.FromMinutes(5));
        }
        return new(true, token);
    }

    public async Task<bool> ResetPasswordAsync(string authorization, string password)
    {
        ResetGrant? grant;
        lock (Gate)
        {
            grant = cache.Get<ResetGrant>("reset:" + authorization);
            cache.Remove("reset:" + authorization);
            if (grant is null || grant.Expires <= DateTimeOffset.UtcNow ||
                grant.Version != cache.Get<int>("recovery-version:" + grant.UserId) ||
                !CryptographicOperations.FixedTimeEquals(grant.TokenHash,
                    SHA256.HashData(Encoding.UTF8.GetBytes(authorization))))
                return false;
            cache.Set("recovery-version:" + grant.UserId, grant.Version + 1, TimeSpan.FromHours(1));
        }
        var account = await users.FindByIdAsync(grant.UserId);
        if (account is null) return false;
        var nativeToken = await users.GeneratePasswordResetTokenAsync(account);
        return (await users.ResetPasswordAsync(account, nativeToken, password)).Succeeded;
    }

    private async Task<OtpIssue> IssueAsync(OtpPurpose purpose, string mobile, string userId,
        string username, string protectedPassword)
    {
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        var salt = RandomNumberGenerator.GetBytes(32);
        var id = RandomId();
        var challenge = new OtpChallenge
        {
            Purpose = purpose, Mobile = mobile, UserId = userId, Username = username,
            ProtectedPassword = protectedPassword, Salt = salt,
            Hash = Hash(salt, code), Expires = DateTimeOffset.UtcNow.AddMinutes(2)
        };
        cache.Set("otp:" + id, challenge, TimeSpan.FromMinutes(2));
        try
        {
            await sms.SendVerifyLookupAsync(mobile, code);
            return new(id, true);
        }
        catch
        {
            cache.Remove("otp:" + id);
            return new("", false);
        }
    }

    private OtpChallenge? Consume(string id, string code, OtpPurpose purpose)
    {
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrEmpty(code) || !Regex.IsMatch(code, "^[0-9]{6}$")) return null;
        lock (Gate)
        {
            var challenge = cache.Get<OtpChallenge>("otp:" + id);
            if (challenge is null || challenge.Purpose != purpose ||
                challenge.Expires <= DateTimeOffset.UtcNow)
            {
                cache.Remove("otp:" + id);
                return null;
            }
            challenge.Attempts++;
            if (challenge.Attempts > 5 ||
                !CryptographicOperations.FixedTimeEquals(challenge.Hash, Hash(challenge.Salt, code)))
            {
                if (challenge.Attempts >= 5) cache.Remove("otp:" + id);
                return null;
            }
            cache.Remove("otp:" + id);
            return challenge;
        }
    }

    private bool Rate(string ip, string account)
    {
        lock (Gate)
        {
            foreach (var key in new[] { "rate:ip:" + ip, "rate:account:" + account })
                if (cache.Get<int>(key) >= 5) return false;
            foreach (var key in new[] { "rate:ip:" + ip, "rate:account:" + account })
                cache.Set(key, cache.Get<int>(key) + 1, TimeSpan.FromMinutes(15));
            return true;
        }
    }

    private async Task<bool> VerifiedMobileExistsAsync(string mobile, string? exceptUserId = null)
    {
        var accounts = await session.Query<User, UserIndex>().ListAsync();
        return accounts.Any(x => x.PhoneNumberConfirmed && x.UserId != exceptUserId &&
            NormalizeIranianMobile(x.PhoneNumber) == mobile);
    }

    private async Task<IUser?> FindByVerifiedMobileAsync(string mobile)
    {
        var accounts = await session.Query<User, UserIndex>().ListAsync();
        return accounts.FirstOrDefault(x => x.PhoneNumberConfirmed &&
            NormalizeIranianMobile(x.PhoneNumber) == mobile);
    }

    private static byte[] Hash(byte[] salt, string code) =>
        SHA256.HashData([.. salt, .. Encoding.UTF8.GetBytes(code)]);
    private static string RandomId() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
}
