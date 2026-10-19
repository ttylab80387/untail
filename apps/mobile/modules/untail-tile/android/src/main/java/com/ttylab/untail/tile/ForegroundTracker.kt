package com.ttylab.untail.tile

import android.app.Activity
import android.app.Application
import android.os.Bundle

// Knows whether an Untail activity is started (visible, possibly under the notification shade).
// Pulling the shade down does not stop the activity, so this tells "was in front" apart from
// "another app was in front" at the moment the tile is tapped.
object ForegroundTracker : Application.ActivityLifecycleCallbacks {
  @Volatile
  private var started = 0

  val isStarted: Boolean
    get() = started > 0

  // Called when the last Untail activity stops, i.e. the user really left Untail. React Native's
  // 'background' comes from onPause, which also fires for dialogs and some notification shades.
  @Volatile
  var onLeft: (() -> Unit)? = null

  override fun onActivityStarted(activity: Activity) {
    started += 1
  }

  override fun onActivityStopped(activity: Activity) {
    started = maxOf(0, started - 1)
    if (started == 0) onLeft?.invoke()
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
  override fun onActivityResumed(activity: Activity) = Unit
  override fun onActivityPaused(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
  override fun onActivityDestroyed(activity: Activity) = Unit
}
