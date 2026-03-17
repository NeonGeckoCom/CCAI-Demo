import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MessageBubble from './MessageBubble';

const CAROUSEL_BREAKPOINT = 700;

const AdvisorCarousel = ({ messages, onReply, onExpand, onClick, onSearchReferences, userAvatarId, userAvatarOptions }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isCarouselMode, setIsCarouselMode] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      setIsCarouselMode(width < CAROUSEL_BREAKPOINT);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [messages.length]);

  const goPrev = useCallback(() => {
    setActiveIndex(i => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setActiveIndex(i => Math.min(messages.length - 1, i + 1));
  }, [messages.length]);

  if (messages.length === 1) {
    return (
      <div className="single-response-wide">
        <MessageBubble
          message={messages[0]}
          onReply={onReply}
          onExpand={onExpand}
          onClick={onClick}
          onSearchReferences={onSearchReferences}
          showReplyButton={true}
          userAvatarId={userAvatarId}
          userAvatarOptions={userAvatarOptions}
        />
      </div>
    );
  }

  return (
    <div
      className={`advisor-carousel ${isCarouselMode ? 'carousel-mode' : 'grid-mode'}`}
      ref={containerRef}
    >
      {isCarouselMode && (
        <button
          className="carousel-arrow carousel-prev"
          onClick={goPrev}
          disabled={activeIndex === 0}
          aria-label="Previous advisor"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      <div className="carousel-viewport">
        <div
          className="carousel-track"
          style={isCarouselMode ? { transform: `translateX(-${activeIndex * 100}%)` } : undefined}
        >
          {messages.map(message => (
            <div key={message.id} className="carousel-slide">
              <MessageBubble
                message={message}
                onReply={onReply}
                onExpand={onExpand}
                onClick={onClick}
                onSearchReferences={onSearchReferences}
                showReplyButton={true}
                inlineAvatar={true}
                userAvatarId={userAvatarId}
                userAvatarOptions={userAvatarOptions}
              />
            </div>
          ))}
        </div>
      </div>

      {isCarouselMode && (
        <>
          <button
            className="carousel-arrow carousel-next"
            onClick={goNext}
            disabled={activeIndex === messages.length - 1}
            aria-label="Next advisor"
          >
            <ChevronRight size={20} />
          </button>

          <div className="carousel-dots">
            {messages.map((m, i) => (
              <button
                key={m.id}
                className={`carousel-dot ${i === activeIndex ? 'active' : ''}`}
                onClick={() => setActiveIndex(i)}
                aria-label={`Go to advisor ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default AdvisorCarousel;
