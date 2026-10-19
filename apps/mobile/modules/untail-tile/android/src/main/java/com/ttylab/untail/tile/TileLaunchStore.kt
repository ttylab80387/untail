package com.ttylab.untail.tile

import android.content.Intent
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicReference

data class TileLaunch(val wasInForeground: Boolean)

// Holds at most one tile request. A tap while one waits is the same request (spec §3.1), so the
// first one, with its foreground state, is kept.
object TileLaunchStore {
  const val EXTRA_LAUNCH = "untail_tile_launch"
  const val EXTRA_WAS_FOREGROUND = "untail_tile_was_foreground"
  const val EXTRA_AT = "untail_tile_at" // SystemClock.elapsedRealtime() of the tap
  private const val MAX_AGE_MS = 15_000L

  private val pending = AtomicReference<TileLaunch?>(null)

  @Volatile
  var listener: (() -> Unit)? = null

  fun put(launch: TileLaunch) {
    pending.compareAndSet(null, launch)
    listener?.invoke()
  }

  fun consume(): TileLaunch? = pending.getAndSet(null)

  // Removes the tile extras, so a recreated activity does not handle the same tap again.
  // After the process was killed, Android rebuilds the activity from the original tile intent
  // (relaunch from recents); such a replay is old or marked as launched from history, and is ignored.
  // A missing foreground flag counts as "was in front", which keeps Untail open.
  fun takeFrom(intent: Intent?): TileLaunch? {
    if (intent?.getBooleanExtra(EXTRA_LAUNCH, false) != true) return null
    val wasInForeground = intent.getBooleanExtra(EXTRA_WAS_FOREGROUND, true)
    val at = intent.getLongExtra(EXTRA_AT, -1L)
    intent.removeExtra(EXTRA_LAUNCH)
    intent.removeExtra(EXTRA_WAS_FOREGROUND)
    intent.removeExtra(EXTRA_AT)
    val age = SystemClock.elapsedRealtime() - at
    val fromHistory = (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
    if (at < 0 || age < 0 || age > MAX_AGE_MS || fromHistory) return null
    return TileLaunch(wasInForeground)
  }
}
