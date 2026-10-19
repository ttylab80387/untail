package com.ttylab.untail.tile

import android.content.Intent
import java.util.concurrent.atomic.AtomicReference

data class TileLaunch(val wasInForeground: Boolean)

// Holds at most one tile request; a newer tap replaces one JS has not taken yet.
object TileLaunchStore {
  const val EXTRA_LAUNCH = "untail_tile_launch"
  const val EXTRA_WAS_FOREGROUND = "untail_tile_was_foreground"

  private val pending = AtomicReference<TileLaunch?>(null)

  @Volatile
  var listener: (() -> Unit)? = null

  fun put(launch: TileLaunch) {
    pending.set(launch)
    listener?.invoke()
  }

  fun consume(): TileLaunch? = pending.getAndSet(null)

  // Removes the tile extras, so a recreated activity does not handle the same tap again.
  // A missing foreground flag counts as "was in front", which keeps Untail open.
  fun takeFrom(intent: Intent?): TileLaunch? {
    if (intent?.getBooleanExtra(EXTRA_LAUNCH, false) != true) return null
    val launch = TileLaunch(intent.getBooleanExtra(EXTRA_WAS_FOREGROUND, true))
    intent.removeExtra(EXTRA_LAUNCH)
    intent.removeExtra(EXTRA_WAS_FOREGROUND)
    return launch
  }
}
