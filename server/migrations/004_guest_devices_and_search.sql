CREATE TABLE guest_devices (
    token text PRIMARY KEY,
    guest_id uuid NOT NULL REFERENCES guests ON DELETE CASCADE
);

-- Store normalized lexemes once per write; compare every query word by prefix.
ALTER TABLE posts ADD COLUMN search_terms tsvector;
CREATE FUNCTION index_post_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.search_terms := to_tsvector('simple',unaccent(NEW.title || ' ' || NEW.body));
    RETURN NEW;
END;
$$;
CREATE TRIGGER post_text_changed BEFORE INSERT OR UPDATE OF title,body ON posts
FOR EACH ROW EXECUTE FUNCTION index_post_text();
UPDATE posts SET title=title;
ALTER TABLE posts ALTER COLUMN search_terms SET NOT NULL;
CREATE INDEX posts_search ON posts USING gin(search_terms);
CREATE FUNCTION feedback_prefixes(text) RETURNS tsquery LANGUAGE sql STABLE AS $$
  SELECT to_tsquery('simple',string_agg(quote_literal(word) || ':*',' & '))
  FROM unnest(tsvector_to_array(to_tsvector('simple',unaccent($1)))) word;
$$;
