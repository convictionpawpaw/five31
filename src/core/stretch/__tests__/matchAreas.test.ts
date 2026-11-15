import { describe, it, expect } from 'vitest';
import { matchAreas, normalizeText, parseAreas } from '../matchAreas.ts';
import { BODY_AREAS, type BodyArea } from '../types.ts';

const allExcept = (...out: BodyArea[]) => BODY_AREAS.filter((a) => !out.includes(a));

describe('matchAreas', () => {
  it("handles the owner's example: neck, back and open up chest", () => {
    expect(matchAreas('neck, back and open up chest')).toEqual([
      'neck',
      'upperBack',
      'lowerBack',
      'chest',
    ]);
  });

  it('is case and punctuation insensitive', () => {
    expect(matchAreas('STIFF NECK!!!')).toEqual(['neck']);
    expect(matchAreas('T-Spine...')).toEqual(['upperBack']);
    expect(matchAreas('  Low-Back, LUMBAR ')).toEqual(['lowerBack']);
  });

  it('prefers specific phrases over the generic words inside them', () => {
    expect(matchAreas('upper back')).toEqual(['upperBack']);
    expect(matchAreas('lower back')).toEqual(['lowerBack']);
    expect(matchAreas('between my shoulder blades')).toEqual(['upperBack']);
    expect(matchAreas('hip flexors')).toEqual(['hips']);
  });

  it('"upper and lower back" in either order gives both back areas', () => {
    expect(matchAreas('upper and lower back')).toEqual(['upperBack', 'lowerBack']);
    expect(matchAreas('lower and upper back')).toEqual(['upperBack', 'lowerBack']);
    expect(matchAreas('my upper & lower back')).toEqual(['upperBack', 'lowerBack']);
    expect(matchAreas('mid and lower back, and neck')).toEqual(['neck', 'upperBack', 'lowerBack']);
  });

  it('"back of" phrases name the body part, not the back', () => {
    expect(matchAreas('back of my neck')).toEqual(['neck']);
    expect(matchAreas('the back of the neck is tight')).toEqual(['neck']);
    expect(matchAreas('back of my thigh')).toEqual(['hamstrings']);
    expect(matchAreas('back of thighs')).toEqual(['hamstrings']);
    expect(matchAreas('back of my legs')).toEqual(['hamstrings', 'calves']);
    expect(matchAreas('back of the leg')).toEqual(['hamstrings', 'calves']);
    expect(matchAreas('front of my thighs')).toEqual(['quads']);
  });

  it('spine regions map to one area only', () => {
    expect(matchAreas('thoracic spine')).toEqual(['upperBack']);
    expect(matchAreas('lumbar spine')).toEqual(['lowerBack']);
    expect(matchAreas('cervical spine')).toEqual(['neck']);
    expect(matchAreas('spine')).toEqual(['upperBack', 'lowerBack']);
  });

  it('knows compact and slang forms', () => {
    expect(matchAreas('lowerback')).toEqual(['lowerBack']);
    expect(matchAreas('upperback')).toEqual(['upperBack']);
    expect(matchAreas('midback')).toEqual(['upperBack']);
    expect(matchAreas('mid back')).toEqual(['upperBack']);
    expect(matchAreas('tspine')).toEqual(['upperBack']);
    expect(matchAreas('calfs')).toEqual(['calves']);
    expect(matchAreas('shin')).toEqual(['calves']);
    expect(matchAreas('shins')).toEqual(['calves']);
    expect(matchAreas('hams')).toEqual(['hamstrings']);
    expect(matchAreas('hammys')).toEqual(['hamstrings']);
    expect(matchAreas('core')).toEqual(['lowerBack']);
    expect(matchAreas('hand')).toEqual(['wristsForearms']);
    expect(matchAreas('hands')).toEqual(['wristsForearms']);
    expect(matchAreas('feet and ankles')).toEqual(['calves']);
  });

  it('upper body / lower body', () => {
    expect(matchAreas('upper body')).toEqual([
      'neck',
      'upperBack',
      'chest',
      'shoulders',
      'wristsForearms',
    ]);
    expect(matchAreas('lower body')).toEqual(['hips', 'glutes', 'hamstrings', 'quads', 'calves']);
  });

  // Decision: "full body" means well-rounded, which the UI already gets from
  // []. parseAreas tells it apart from "nothing recognised" via fullBody.
  it('full body / whole body / everything mean well-rounded ([])', () => {
    for (const t of ['full body', 'whole body', 'everything', 'head to toe', 'sore all over']) {
      expect(matchAreas(t), t).toEqual([]);
      expect(parseAreas(t).fullBody, t).toBe(true);
    }
    expect(parseAreas('make me feel good').fullBody).toBe(false);
  });

  // Decision: an exclusion with nothing else named (or with "everything")
  // returns every area minus the excluded ones, so the routine really avoids
  // them. Falling back to [] (well-rounded) would put them straight back in.
  it('negation excludes the named areas', () => {
    expect(matchAreas('not my neck')).toEqual(allExcept('neck'));
    expect(matchAreas('avoid lower back')).toEqual(allExcept('lowerBack'));
    expect(matchAreas('everything except legs')).toEqual(
      allExcept('hamstrings', 'quads', 'calves'),
    );
    expect(matchAreas('everything but my legs')).toEqual(
      allExcept('hamstrings', 'quads', 'calves'),
    );
    expect(matchAreas('no hamstrings')).toEqual(allExcept('hamstrings'));
    expect(matchAreas('skip the shoulders')).toEqual(allExcept('shoulders'));
    expect(matchAreas("don't do my neck")).toEqual(allExcept('neck'));
    expect(parseAreas('skip the shoulders').excluded).toEqual(['shoulders']);
  });

  it('negation is scoped to the phrase after it (until comma / and / but)', () => {
    expect(matchAreas('hips, not hamstrings')).toEqual(['hips']);
    expect(matchAreas('neck but not shoulders')).toEqual(['neck']);
    expect(matchAreas('no neck and chest please')).toEqual(['chest']);
    expect(matchAreas('avoid the neck, back is fine')).toEqual(['upperBack', 'lowerBack']);
    expect(matchAreas('back but skip lower back')).toEqual(['upperBack']);
    expect(matchAreas('my neck is not great')).toEqual(['neck']);
  });

  it('does not fire on idioms that only contain an area word', () => {
    for (const t of [
      'come back later',
      'get back into it',
      'lean back',
      'head to toe',
      'trap bar deadlift',
      'hip hop',
    ]) {
      const p = parseAreas(t);
      expect(p.fullBody ? [] : p.areas, t).toEqual([]);
    }
    expect(parseAreas('trap bar deadlift').fullBody).toBe(false);
    expect(matchAreas('coming back to stretching, neck is stiff')).toEqual(['neck']);
  });

  it('finds several areas in one phrase, in canonical order', () => {
    expect(matchAreas('hammies, low back and traps')).toEqual(['neck', 'lowerBack', 'hamstrings']);
    expect(matchAreas('pecs and calves')).toEqual(['chest', 'calves']);
    expect(matchAreas('tight hips and glutes from sitting')).toEqual([
      'lowerBack',
      'hips',
      'glutes',
      'hamstrings',
    ]);
    expect(matchAreas('neck neck NECK and neck')).toEqual(['neck']);
  });

  it('maps lifestyle words', () => {
    expect(matchAreas('desk posture')).toEqual(['neck', 'upperBack', 'chest']);
    expect(matchAreas('typing all day')).toEqual(['wristsForearms']);
  });

  it('does not match inside other words', () => {
    // "background"/"backpack" contain "back"; "hipster"/"ship" contain "hip";
    // "chestnut" contains "chest"; "bottleneck" contains "neck".
    expect(matchAreas('background hipster chestnut')).toEqual([]);
    expect(matchAreas('backpack ship bottleneck')).toEqual([]);
  });

  it('returns [] for nothing recognisable or empty input', () => {
    expect(matchAreas('')).toEqual([]);
    expect(matchAreas('   ')).toEqual([]);
    expect(matchAreas('make me feel good')).toEqual([]);
  });

  it('normalizeText collapses punctuation runs', () => {
    expect(normalizeText(' T--Spine,,  Neck! ')).toBe('t spine neck');
  });
});
