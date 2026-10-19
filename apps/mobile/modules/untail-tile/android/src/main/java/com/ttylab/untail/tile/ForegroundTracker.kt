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

  override fun onActivityStarted(activity: Activity) {
    started += 1
  }

  override fun onActivityStopped(activity: Activity) {
    started = maxOf(0, started - 1)
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
  override fun onActivityResumed(activity: Activity) = Unit
  override fun onActivityPaused(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
  override fun onActivityDestroyed(activity: Activity) = Unit
}
