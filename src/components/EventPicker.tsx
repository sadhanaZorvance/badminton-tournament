import type { Event, EventStatus } from '../types';

interface EventPickerProps {
  events: Event[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
}

const STATUS_DOT_CLASS: Record<EventStatus, string> = {
  pending: 'bg-slate',
  active: 'bg-emerald-400',
  complete: 'bg-sky-400',
  published: 'bg-gold-bright',
};

export default function EventPicker({ events, selectedEventId, onSelect }: EventPickerProps) {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-thin"
      role="tablist"
      aria-label="Events"
    >
      {events.map((event) => {
        const isSelected = event.id === selectedEventId;
        return (
          <button
            key={event.id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(event.id)}
            className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border min-h-[36px] font-body text-sm transition-colors ${
              isSelected
                ? 'bg-gold/20 text-gold-bright border-gold'
                : 'bg-navy-light/50 text-slate-light border-navy-light hover:bg-navy-light'
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT_CLASS[event.status]}`} />
            {isSelected ? (
              <span className="flex flex-col leading-none">
                <span className="font-semibold text-sm">{event.code}</span>
                <span className="text-[9px] font-normal text-gold/80 leading-tight mt-0.5 max-w-[88px] truncate">
                  {event.name}
                </span>
              </span>
            ) : (
              <span className="font-semibold">{event.code}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
