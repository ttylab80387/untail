package com.ttylab.untail.tile

import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log

class CleanLinkTileService : TileService() {
  override fun onStartListening() {
    // An action tile, not a switch: always shown as inactive.
    qsTile?.let {
      it.state = Tile.STATE_INACTIVE
      it.updateTile()
    }
  }

  override fun onClick() {
    try {
      // Read the foreground state when the launch happens, which is after unlocking when locked
      // (spec §4.2). It must still be read before launchUntail starts the activity.
      val launch = Runnable { launchUntail(ForegroundTracker.isStarted) }
      if (isLocked) unlockAndRun(launch) else launch.run()
    } catch (e: Exception) {
      Log.w(TAG, "tile click failed", e)
    }
  }

  private fun launchUntail(wasInForeground: Boolean) {
    try {
      val component = packageManager.getLaunchIntentForPackage(packageName)?.component ?: return
      // A plain intent to the activity (not the launcher action), so a running singleTask
      // activity receives it through onNewIntent.
      val intent = Intent()
        .setComponent(component)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(TileLaunchStore.EXTRA_LAUNCH, true)
        .putExtra(TileLaunchStore.EXTRA_WAS_FOREGROUND, wasInForeground)
        .putExtra(TileLaunchStore.EXTRA_AT, SystemClock.elapsedRealtime())
      if (Build.VERSION.SDK_INT >= 34) {
        val mode = if (Build.VERSION.SDK_INT >= 36) {
          ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS
        } else {
          @Suppress("DEPRECATION")
          ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
        }
        val options = ActivityOptions.makeBasic().setPendingIntentCreatorBackgroundActivityStartMode(mode).toBundle()
        val pending = PendingIntent.getActivity(
          this,
          0,
          intent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
          options,
        )
        startActivityAndCollapse(pending)
      } else {
        @Suppress("DEPRECATION")
        startActivityAndCollapse(intent)
      }
    } catch (e: Exception) {
      Log.w(TAG, "could not open Untail from the tile", e)
    }
  }

  private companion object {
    const val TAG = "UntailTile"
  }
}
