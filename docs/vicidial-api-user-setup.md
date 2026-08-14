# Setting up a VICIdial API-only user for DID Optimizer

This guide creates a VICIdial user that DID Optimizer Pro can log in with to **read your campaigns and DIDs** (read-only — no agent or dialing functions). It includes every setting we actually call, the order to set them, and the four common errors with the exact field to flip.

If you only want the checklist, jump to [§ TL;DR](#tldr).

---

## Why a dedicated API user

We log into your VICIdial through its **NON_AGENT API** (`/vicidial/non_agent_api.php`) to do two things:

| What we call | VICIdial function | What it returns | Required permission(s) |
|---|---|---|---|
| Verify connection / sync campaigns | `campaigns_list` | List of campaigns visible to the user | `view_reports = 1` **or** `modify_campaigns = 1` |
| Sync DIDs (discovery mode) | `did_log_export` | Inbound DID call log (we derive the DID list) | `view_reports = 1` **or** `modify_inbound_dids = 1` |
| Connectivity ping | `version` | VICIdial server version | (Any authenticated user) |

A dedicated `API001`-style user means: (1) it shows up clearly in your audit log, (2) you can rotate its password without touching agent accounts, and (3) it can be locked to a single source IP.

---

## TL;DR

In VICIdial Admin → Users → Add A New User, create a user with these exact values:

| Field | Value | Why |
|---|---|---|
| **User Number** | `API001` (or similar) | Login ID |
| **Password** | 12+ chars, alphanumeric only — **no `!@#$&` symbols, VICIdial strips them silently** | Auth |
| **Full Name** | `API only user` | Identification in logs |
| **User Level** | `8` | Required minimum for API access |
| **User Group** | **A real group with `allowed_campaigns = -ALL-CAMPAIGNS-`** (typically `ADMIN`, `MANAGERS`, or a dedicated `API_USERS` group) — **NOT `---ALL---`** | `---ALL---` is a placeholder, not a real group. `campaigns_list` returns nothing for it. See [§ Campaigns and user groups](#campaigns-and-user-groups). |
| **Active** | `Y` | |

Then on the **same user's modify page**, scroll to the indicated sections and set:

### Section: API USER OPTIONS

| Field | Value | Why |
|---|---|---|
| `Agent API Access` | `1` | Enables NON_AGENT API access |
| `API Only User` | `1` | Removes admin/agent UI screens; the user can ONLY auth via API |
| `API Allowed Functions` | `ALL_FUNCTIONS` | Or specifically: `version`, `campaigns_list`, `did_log_export` |
| `API List Restrict` | `0` | Don't restrict which lists this user can see |

### Section: ADMIN MENU OPTIONS (also called USER PERMISSIONS — easy to miss)

| Field | Value | Why |
|---|---|---|
| `view_reports` | `1` | **Required by `campaigns_list` and `did_log_export`** |
| `campaign_detail` | `1` | Required for campaign metadata in the response |
| `modify_inbound_dids` | `1` | Required by some VICIdial forks for DID-related queries |
| `modify_campaigns` | `0` (leave off) | We don't need write access; only `view_reports` is required for reads |
| `modify_lists` | `0` (leave off) | Same — read-only is enough |

### Then: IP whitelist

Add our scoring server IP to the **Whitelist** IP list (Admin → IP Lists → MODIFY on `Whitelist`):

```
65.21.161.173   ← api3.amdy.io (our scoring host)
```

Save. Done. Test from DID Optimizer's Settings → VICIdial Integration → "Test Connection".

---

## Step-by-step with screenshots-worth descriptions

### Step 1 — Create the user

1. VICIdial Admin → **Users** (top nav)
2. Click **"Add A New User"**
3. Clear the `AUTOGENERATEZZZ` placeholder in **User Number** and type `API001`
4. **Password:** type something strong, **but alphanumeric only** (mixed case + digits). VICIdial silently strips `! @ # $ & % ^ * ( ) +` from passwords. A 16-character alphanumeric like `Vx9mK2pL7qR4nZ8w` is fine.
5. **Full Name:** `API only user`
6. **User Level:** `8`
7. **User Group:** pick a group that actually has campaigns assigned — `ADMIN` or `MANAGERS` are usually safe (both have `allowed_campaigns = -ALL-CAMPAIGNS-`). **Do not leave it as `---ALL---`** — that's a placeholder and `campaigns_list` will return zero campaigns. See [§ Campaigns and user groups](#campaigns-and-user-groups) for the dedicated-group option.
8. Click **SUBMIT**

You should see `USER ADDED: API001` at the top.

### Step 2 — Enable API access

You're now on the **Modify User** page. Scroll down to the **API USER OPTIONS** section (near the bottom).

| Setting | Set to |
|---|---|
| Agent API Access | `1` |
| API Only User | `1` |
| API Allowed Functions | scroll the listbox and select **`ALL_FUNCTIONS`** |
| API List Restrict | `0` |

### Step 3 — Enable the read permissions VICIdial actually checks

⚠️ **This step is the one that's easy to skip.** Setting `ALL_FUNCTIONS` does NOT bypass the per-permission checks below. VICIdial's API checks the user's normal permission flags before returning data.

In the same user page, find these fields in the **Admin Menu Options** block:

| Setting | Set to | Triggered when… |
|---|---|---|
| `view_reports` | **`1`** | Almost always — `campaigns_list`, `did_log_export`, and most read-only functions check this |
| `campaign_detail` | **`1`** | Required to read campaign metadata |
| `modify_inbound_dids` | **`1`** | Some VICIdial builds require this specifically for DID list/log exports |

Leave the `modify_*` write-permissions (modify_campaigns, modify_lists, modify_users, etc.) at `0`. We don't need them and you shouldn't grant write permission to an API account that doesn't need it.

Click **SUBMIT**. You should see `USER MODIFIED - ADMIN: API001`.

### Step 4 — Whitelist our IP

DID Optimizer calls your VICIdial server from a fixed IP. Add it to your VICIdial allowed IPs:

1. Admin → **IP Lists**
2. Click **MODIFY** on the `Whitelist` entry
3. On a new line at the end of the textarea, add:
   ```
   65.21.161.173
   ```
   (this is `api3.amdy.io`)
4. Click **SUBMIT**

If you also have a separate `ViciWhite` list that gates API access on your install, add it there too.

### Step 5 — Test from DID Optimizer

1. Open https://dids.amdy.io/settings
2. Click the **VICIdial Integration** tab
3. Fill in:
   - **VICIdial Server IP / Hostname:** your VICIdial admin URL host (e.g. `sharktech2.dialer.one`)
   - **API Username:** `API001`
   - **API Password:** the password you set
4. Click **Save Credentials**
5. Click **Test Connection**

You should see a green banner: **✓ Successfully authenticated with VICIdial (N campaigns visible) — credentials saved**.

A `0 campaigns visible` result is OK — it means auth and permissions are correct; you just haven't assigned campaigns to this API user's group yet (see [§ Campaigns / Groups](#campaigns-and-user-groups) below).

---

## Troubleshooting common errors

### ❌ "Permission denied — Please grant the campaigns_list permission"

The API is reachable and authentication works, but VICIdial rejected the function call.

**Most likely cause:** `view_reports = 0` on the user **or** on the user_group. The API checks both.

**Fix:**
- On the user's Modify page, set `view_reports = 1`
- Then check the user_group's permissions: Admin → User Groups → click the user's group → confirm `view_reports = 1` there too
- If your `---ALL---` group has `view_reports = 0`, either change it (affects everyone) or move the API user into a dedicated user_group with `view_reports = 1`

### ❌ "USER DOES NOT HAVE PERMISSION TO GET CAMPAIGN INFO"

Same root cause as above, raw VICIdial wording. Same fix.

### ⚠️ "Successfully authenticated (0 campaigns visible)" / "Synced 0 campaigns"

Auth works, permissions are right — but the API user belongs to a user_group with no campaigns assigned.

**Most likely cause:** The user's `User Group` is `---ALL---`. That value is a placeholder, not a real user_group row — so it has no `allowed_campaigns` and `campaigns_list` returns nothing.

**Fix:** Admin → Users → API001 → MODIFY → change `User Group` from `---ALL---` to a real group whose `allowed_campaigns = -ALL-CAMPAIGNS-`. On most VICIdial installs that's `ADMIN` or `MANAGERS`. SUBMIT and re-test from DID Optimizer.

To verify directly in MySQL on your VICIdial host:
```sql
SELECT user_group, allowed_campaigns FROM vicidial_user_groups;
```
Pick any group whose `allowed_campaigns` contains `-ALL-CAMPAIGNS-`, then assign that group to the API user.

### ⚠️ "Synced 0 campaigns" even though the user_group is correct

Some VICIdial installs only return campaigns marked `active = 'Y'`. If every campaign in your install is `active = 'N'`, `campaigns_list` will be empty regardless of permissions.

**Fix:** activate at least one campaign in VICIdial Admin → Campaigns → MODIFY → Active = `Y`. (DID Optimizer doesn't itself require active campaigns — but the sync is gated by what VICIdial chooses to return.)

### ❌ "Invalid Username / Password"

The password you typed in DID Optimizer doesn't match what VICIdial stored.

**Most common reason:** VICIdial stripped special characters from your password when you saved it. Your password is shorter in the DB than what you typed.

**Fix:** Edit the user, set a new password using only `A-Z a-z 0-9` (16 chars is plenty), save, then paste exactly the same string into DID Optimizer's Settings.

### ❌ "Permission denied — your IP is not whitelisted"

VICIdial blocked the request because the source IP isn't on the IP allow list.

**Fix:** Make sure `65.21.161.173` is in the **Whitelist** IP list (Admin → IP Lists). Also check System Settings → `Allow IP Lists` is set to `1`. After saving, no restart is required.

### ❌ Connection times out

Either DNS isn't resolving your VICIdial hostname, the host is offline, or firewall rules are blocking us.

**Fix:**
- From a terminal: `curl -sI https://your-vicidial-host/vicidial/non_agent_api.php` — should return `HTTP/2 200`
- Confirm port 443 is open to `65.21.161.173`
- If you're using Cloudflare or a WAF in front of VICIdial, allowlist our IP at that layer too

---

## Campaigns and user groups

`campaigns_list` returns campaigns the API user is *allowed to see*, based on the user's **user_group → allowed_campaigns** setting.

⚠️ **The `---ALL---` value is a placeholder, NOT a real group.** It has no row in `vicidial_user_groups` and therefore no `allowed_campaigns`. If you leave the API user in `---ALL---`, every call to `campaigns_list` returns "0 viewable campaigns."

You have two correct options:

**Option A — quickest:** put the API user in an existing group whose `allowed_campaigns = -ALL-CAMPAIGNS-`. On stock VICIdial installs that's `ADMIN` or `MANAGERS`. Verify by running this query on your VICIdial DB:
```sql
SELECT user_group, allowed_campaigns FROM vicidial_user_groups
WHERE allowed_campaigns LIKE '%-ALL-CAMPAIGNS-%';
```
Any group from that result works.

**Option B — recommended for multi-tenant operators:** create a dedicated user group for API usage:
1. Admin → **User Groups** → **Add A New User Group**
2. **Group:** `API_USERS` · **Group Name:** `API only users`
3. Set `view_reports = 1`
4. Set `allowed_campaigns` to `-ALL-CAMPAIGNS-` (wildcard) or list the specific campaign IDs you want exposed
5. SUBMIT
6. Edit the `API001` user → change **User Group** to `API_USERS` → SUBMIT

Option B keeps your API user isolated from regular admin/manager activity in audit logs, and lets you scope which campaigns are exposed without affecting human accounts.

---

## Security checklist before going live

- [ ] Password is alphanumeric, 16+ chars, generated randomly
- [ ] `API Only User = 1` (so the credentials can't be used to log into the admin GUI)
- [ ] No `modify_*` write permissions are enabled
- [ ] Source IP `65.21.161.173` is in the IP Whitelist
- [ ] User Level is `8`, not `9` (`9` is superuser; you don't want that here)
- [ ] User_group has `view_reports = 1` (matches user-level setting)
- [ ] Last Login Info on the user's record shows our IP after Test Connection succeeds

---

## Rotating the password later

1. Admin → Users → click `API001` → MODIFY
2. Change **Password** field, SUBMIT
3. DID Optimizer → Settings → VICIdial Integration → update Password → Save Credentials → Test Connection

Both sides updated, no service restart needed on either end.

---

## Why we built it this way

Most DID rotation tools ask for *full VICIdial admin credentials*. That's overkill: we only need to read campaigns and the DID call log. By scoping a dedicated API-only user with `view_reports = 1` and nothing else, you give us exactly what we need — and nothing more. If someone ever compromises the credentials, they can read your campaigns; they can't dial, modify lists, change call routing, delete leads, or escalate to admin.

---

## Reference: every API call DID Optimizer makes against your VICIdial

| When | Function | Endpoint | What we send | What we read |
|---|---|---|---|---|
| You click **Test Connection** | `campaigns_list` | `/vicidial/non_agent_api.php` | `user=API001 pass=… function=campaigns_list` | Number of campaigns visible (count only) |
| Every N min via auto-sync | `did_log_export` | `/vicidial/non_agent_api.php` | `user=API001 pass=… function=did_log_export date_from=… date_to=…` | Distinct `caller_id_number` column values (these become your DID inventory) |
| Optional manual sync | `campaigns_list` | `/vicidial/non_agent_api.php` | as above | Campaign IDs + names |
| Health ping | `version` | `/vicidial/non_agent_api.php` | `user=API001 pass=… function=version` | VICIdial version string |

That's the complete list. We never call any function that writes to your VICIdial database.
