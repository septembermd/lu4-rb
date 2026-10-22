package lu4.rb

import com.ikar.script.api.*
import com.google.gson.*
import kotlinx.coroutines.*
import java.net.URI
import java.net.http.*
import java.nio.file.*
import java.time.*
import java.util.UUID

/** Experimental single-account adapter. Never logs tokens or game credentials. */
class RaidScout : IkaScript {
    override val meta = ScriptMeta(id = "lu4-rb-scout", name = "LU4 RB Scout", version = "0.1.0")
    override suspend fun run(bot: L2Bot) {
        val configPath = System.getenv("LU4_RB_CONFIG") ?: error("LU4_RB_CONFIG required")
        val config = JsonParser.parseString(Files.readString(Path.of(configPath))).asJsonObject
        fun setting(key: String) = config.get(key)?.asString ?: error("Missing $key")
        val base = URI.create(setting("apiUrl").trimEnd('/'))
        require(base.scheme == "https" || (base.scheme == "http" && base.host in listOf("localhost", "127.0.0.1")))
        require(base.userInfo == null && base.query == null && base.fragment == null)
        val token = setting("agentToken")
        val clientId = setting("clientId")
        val accountKey = setting("accountKey")
        require(clientId.matches(Regex("[A-Za-z0-9_-]{1,64}")))
        val pending = Path.of(configPath).toAbsolutePath().parent.resolve("pending-$clientId.json")
        val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build()
        suspend fun post(path: String, payload: JsonObject): Pair<Int, JsonObject> = withContext(Dispatchers.IO) {
            val req = HttpRequest.newBuilder(URI.create("$base$path")).timeout(Duration.ofSeconds(12))
                .header("Authorization", "Bearer $token").header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payload.toString())).build()
            val res = http.send(req, HttpResponse.BodyHandlers.ofString())
            val parsed = runCatching { JsonParser.parseString(res.body()).asJsonObject }.getOrElse { JsonObject() }
            res.statusCode() to parsed
        }
        suspend fun deliver(payload: JsonObject): Boolean {
            val (code, _) = post("/api/agent/v1/observations", payload)
            if (code in 200..299) { Files.deleteIfExists(pending); return true }
            // Never drop unacknowledged evidence. 400/409 can indicate a stale lease or payload bug.
            // Keep it on disk for operator inspection rather than silently losing the observation.
            if (code == 400 || code == 409) error("Observation rejected by API (HTTP $code); pending payload preserved: $pending")
            if (code == 401 || code == 403) error("Agent access denied; pending payload preserved")
            return false
        }
        bot.disableAutomation()
        // Do not restore combat automation automatically for a parked/dead scout.
        while (currentCoroutineContext().isActive) {
            try {
                if (Files.exists(pending)) {
                    if (!deliver(JsonParser.parseString(Files.readString(pending)).asJsonObject)) { delay(5000); continue }
                }
                val request = JsonObject().apply { addProperty("clientId", clientId); addProperty("accountKey", accountKey) }
                val (code, job) = post("/api/agent/v1/scouts/claim", request)
                if (code == 401 || code == 403) error("Agent access denied")
                if (code !in 200..299) { delay(5000); continue }
                if (!job.has("lease") || job.get("lease").isJsonNull) { delay(5000); continue }
                val lease = job.getAsJsonObject("lease")
                val c = job.getAsJsonObject("character")
                require(c.get("account_key").asString == accountKey) { "Account mismatch: stop and resolve outstanding lease" }
                val leaseId = lease.get("id").asString
                val heartbeat = JsonObject().apply { addProperty("leaseId", leaseId); addProperty("clientId", clientId) }
                // Bound all game work below the initial 2-minute lease; heartbeat confirms ownership first.
                val heartbeatCode = post("/api/agent/v1/scouts/heartbeat", heartbeat).first
                if (heartbeatCode == 401 || heartbeatCode == 403 || heartbeatCode == 409) error("Lease heartbeat rejected (HTTP $heartbeatCode); stop this client")
                if (heartbeatCode !in 200..299) { delay(5000); continue }
                val expectedName = c.get("name").asString
                var world = false
                var position = false
                var alive = false
                var found = false
                val completed = withTimeoutOrNull(60000) {
                    if (!bot.restart() || !bot.selectCharacter(c.get("slot").asInt)) return@withTimeoutOrNull false
                    delay(5000)
                    repeat(5) {
                        val user = bot.user
                        world = user.name == expectedName && user.oid != 0
                        position = world && user.distTo(c.get("expected_x").asInt,c.get("expected_y").asInt,c.get("expected_z").asInt) <= c.get("radius").asInt
                        alive = !user.dead
                        if (position && bot.npcs.any { it.id == c.get("boss_id").asInt && !it.dead }) found = true
                        delay(1000)
                    }
                    true
                } ?: false
                // Presence is evidence. Absence is not asserted until full visibility is validated in game.
                val success = completed && world && position && found
                val payload = JsonObject().apply {
                    addProperty("clientEventId", UUID.randomUUID().toString()); addProperty("leaseId",leaseId); addProperty("clientId",clientId)
                    addProperty("bossId", c.get("boss_id").asInt); addProperty("observedAt",Instant.now().toString())
                    addProperty("result", if(success) "alive" else "failed")
                    if(!success) addProperty("failureCode",when { !completed -> "entry_failed"; !world -> "wrong_character"; !position -> "wrong_position"; else -> "coverage_unverified" })
                    add("evidence",JsonObject().apply { addProperty("worldLoaded",world); addProperty("characterAlive",alive); addProperty("atExpectedLocation",position); addProperty("spawnCoverageComplete",false) })
                }
                val tmp = pending.resolveSibling(pending.fileName.toString()+".tmp")
                Files.writeString(tmp,payload.toString())
                Files.move(tmp,pending,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE)
                if (!deliver(payload)) bot.log("LU4 RB: observation queued locally; retrying delivery")
                delay(1000)
            } catch(e: CancellationException) { throw e }
              catch(e: IllegalArgumentException) { throw e }
              catch(e: IllegalStateException) { throw e }
              catch(e: Exception) { bot.log("LU4 RB: transport/check failed; retry in 5s"); delay(5000) }
        }
    }
}
