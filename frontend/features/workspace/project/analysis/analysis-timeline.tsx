import { AgentRunView, WorkflowEvent } from "../../../../app/lib/api";
import { activityPresentation } from "../../shared/activity-presentation";

interface AnalysisTimelineProps {
  events: WorkflowEvent[];
  run: AgentRunView | null;
}

export function AnalysisTimeline({ events, run }: AnalysisTimelineProps) {
  return (
    <div className="event-timeline">
      <div className="panel-title">
        <span>최근 활동</span>
        <small>{events.length ? `${events.length}개 기록` : "기록 없음"}</small>
      </div>
      {events.length === 0 ? (
        <p className="empty-copy">분석을 시작하면 진행 상황이 이곳에 표시됩니다.</p>
      ) : (
        <ol>
          {events
            .slice(-8)
            .reverse()
            .map((event) => {
              const activity = activityPresentation(event, run);
              return (
                <li key={event.eventId} className={`event-activity event-activity-${activity.tone}`}>
                  <span className="event-activity-marker" aria-hidden="true" />
                  <div className="event-activity-copy">
                    <strong>{activity.title}</strong>
                    {activity.detail && <p>{activity.detail}</p>}
                    {activity.tags.length > 0 && (
                      <div className="event-activity-tags">
                        {activity.tags.map((tag, index) => (
                          <code key={`${tag}-${index}`}>{tag}</code>
                        ))}
                      </div>
                    )}
                  </div>
                  <time>
                    {event.occurredAt
                      ? new Date(event.occurredAt).toLocaleTimeString("ko-KR")
                      : "방금"}
                  </time>
                </li>
              );
            })}
        </ol>
      )}
    </div>
  );
}
